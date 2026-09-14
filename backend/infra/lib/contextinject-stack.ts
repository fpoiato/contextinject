import * as path from "node:path";
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Size,
  Stack,
  type StackProps,
  TimeZone,
  aws_certificatemanager as acm,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_cognito as cognito,
  aws_ec2 as ec2,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_lambda_nodejs as lambdaNodejs,
  aws_logs as logs,
  aws_rds as rds,
  aws_route53 as route53,
  aws_route53_targets as targets,
  aws_s3 as s3,
  aws_s3_deployment as s3deploy,
  aws_scheduler as scheduler,
  aws_scheduler_targets as schedulerTargets,
} from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { AwsCustomResource, AwsCustomResourcePolicy, PhysicalResourceId } from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";

const APP_DOMAIN = "contextinject.fpoiato.com";
const API_DOMAIN = "api.contextinject.fpoiato.com";
const LEGACY_APP_DOMAIN = "easyrag.fpoiato.com";
const LEGACY_API_DOMAIN = "api.easyrag.fpoiato.com";
const ZONE_NAME = "fpoiato.com";
const ZONE_ID = "Z094351536ZBINA5SU45F";
const LOCAL_ORIGIN = "http://localhost:4200";
const APP_ORIGINS = [`https://${APP_DOMAIN}`, `https://${LEGACY_APP_DOMAIN}`, LOCAL_ORIGIN];
// Hidden Cognito hosted-domain prefix. Changing it replaces the domain and fails
// while the old prefix still exists; custom login never shows this hostname.
const COGNITO_DOMAIN_PREFIX = "easyrag-fpoiato";
// Physical secret/DB names stay put so existing keys and the Postgres database keep working.
const USER_SECRET_PREFIX = "easyrag/users";
const SES_FROM_EMAIL = "noreply@fpoiato.com";
const SES_FROM_NAME = "contextinject";
const SES_MAIL_FROM = `mail.${ZONE_NAME}`;

export class ContextInjectStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const zone = route53.HostedZone.fromHostedZoneAttributes(this, "Zone", {
      hostedZoneId: ZONE_ID,
      zoneName: ZONE_NAME,
    });

    // DKIM CNAMEs and MAIL FROM MX/TXT for fpoiato.com already exist in Route53
    // (SES identity predates this stack). Do not recreate them here.
    new AwsCustomResource(this, "SesMailFrom", {
      onUpdate: {
        service: "SESv2",
        action: "putEmailIdentityMailFromAttributes",
        parameters: {
          EmailIdentity: ZONE_NAME,
          MailFromDomain: SES_MAIL_FROM,
          BehaviorOnMxFailure: "USE_DEFAULT_VALUE",
        },
        physicalResourceId: PhysicalResourceId.of(`${ZONE_NAME}-mail-from`),
      },
      policy: AwsCustomResourcePolicy.fromSdkCalls({ resources: AwsCustomResourcePolicy.ANY_RESOURCE }),
    });

    const certificate = new acm.Certificate(this, "Cert", {
      domainName: APP_DOMAIN,
      subjectAlternativeNames: [API_DOMAIN, LEGACY_APP_DOMAIN, LEGACY_API_DOMAIN],
      validation: acm.CertificateValidation.fromDns(zone),
    });

    const vpc = new ec2.Vpc(this, "Vpc", {
      ipAddresses: ec2.IpAddresses.cidr("10.80.0.0/16"),
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: "public",
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
      ],
    });

    const dbSg = new ec2.SecurityGroup(this, "DbSg", {
      vpc,
      description: "contextinject PostgreSQL",
      allowAllOutbound: true,
    });
    dbSg.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(5432),
      "Public RDS so Lambdas can connect without a NAT Gateway",
    );

    const parameterGroup = new rds.ParameterGroup(this, "PgParams", {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16,
      }),
      parameters: {
        "rds.force_ssl": "1",
      },
    });

    const database = new rds.DatabaseInstance(this, "Postgres", {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16,
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [dbSg],
      publiclyAccessible: true,
      storageEncrypted: true,
      allocatedStorage: 20,
      maxAllocatedStorage: 20,
      storageType: rds.StorageType.GP3,
      multiAz: false,
      credentials: rds.Credentials.fromGeneratedSecret("easyrag", {
        secretName: "easyrag/db",
      }),
      databaseName: "easyrag",
      parameterGroup,
      backupRetention: Duration.days(1),
      deleteAutomatedBackups: true,
      deletionProtection: false,
      removalPolicy: RemovalPolicy.DESTROY,
      cloudwatchLogsExports: ["postgresql"],
      cloudwatchLogsRetention: logs.RetentionDays.ONE_WEEK,
      enablePerformanceInsights: false,
      autoMinorVersionUpgrade: true,
      instanceIdentifier: "easyrag-pg",
    });

    const documentsBucket = new s3.Bucket(this, "Documents", {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        {
          abortIncompleteMultipartUploadAfter: Duration.days(1),
        },
      ],
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedOrigins: APP_ORIGINS,
          allowedHeaders: ["*"],
          exposedHeaders: ["ETag", "x-amz-request-id"],
          maxAge: 3600,
        },
      ],
    });

    const frontendBucket = new s3.Bucket(this, "Frontend", {
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const userPool = new cognito.UserPool(this, "Users", {
      userPoolName: "contextinject-users",
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      signInCaseSensitive: false,
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      passwordPolicy: {
        minLength: 10,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      email: cognito.UserPoolEmail.withSES({
        fromEmail: SES_FROM_EMAIL,
        fromName: SES_FROM_NAME,
        sesRegion: this.region,
        sesVerifiedDomain: ZONE_NAME,
      }),
      userVerification: {
        emailSubject: "Your contextinject verification code",
        emailBody: `Your contextinject verification code is {####}. Enter it at https://${APP_DOMAIN}/verify`,
        emailStyle: cognito.VerificationEmailStyle.CODE,
      },
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const userPoolClient = userPool.addClient("Web", {
      userPoolClientName: "contextinject-web",
      generateSecret: false,
      preventUserExistenceErrors: true,
      // adminUserPassword needs IAM credentials; it exists for operator smoke tests only.
      authFlows: { userSrp: true, adminUserPassword: true },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: [
          `https://${APP_DOMAIN}/auth/callback`,
          `https://${LEGACY_APP_DOMAIN}/auth/callback`,
          `${LOCAL_ORIGIN}/auth/callback`,
        ],
        logoutUrls: [`https://${APP_DOMAIN}/`, `https://${LEGACY_APP_DOMAIN}/`, `${LOCAL_ORIGIN}/`],
      },
      idTokenValidity: Duration.hours(1),
      accessTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
    });

    const userPoolDomain = userPool.addDomain("Domain", {
      cognitoDomain: { domainPrefix: COGNITO_DOMAIN_PREFIX },
      managedLoginVersion: cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });

    new cognito.CfnManagedLoginBranding(this, "Branding", {
      userPoolId: userPool.userPoolId,
      clientId: userPoolClient.userPoolClientId,
      useCognitoProvidedValues: true,
      returnMergedResources: false,
    });

    new cognito.CfnUserPoolGroup(this, "AdminGroup", {
      userPoolId: userPool.userPoolId,
      groupName: "admin",
      description: "contextinject operators: can stop the database and manage plans",
    });

    const commonLogRetention = logs.RetentionDays.ONE_WEEK;
    const embedCode = lambda.Code.fromAsset(path.join(__dirname, "../../lambdas/embed/.bundle"));
    const ingestCode = lambda.Code.fromAsset(path.join(__dirname, "../../lambdas/ingest/.bundle"));

    const embedFn = new lambda.Function(this, "EmbedFn", {
      runtime: lambda.Runtime.PYTHON_3_12,
      architecture: lambda.Architecture.X86_64,
      handler: "handler.handler",
      code: embedCode,
      timeout: Duration.minutes(10),
      memorySize: 2048,
          ephemeralStorageSize: Size.mebibytes(1024),
      logRetention: commonLogRetention,
      environment: {
        DB_SECRET_ARN: database.secret!.secretArn,
        DB_HOST: database.instanceEndpoint.hostname,
        DB_NAME: "easyrag",
        DOCUMENTS_BUCKET: documentsBucket.bucketName,
        EMBEDDING_MODEL_ID: "Xenova/multilingual-e5-base",
        EMBEDDING_S3_KEY: "models/multilingual-e5-base/model_quantized.onnx",
      },
    });

    const ingestFn = new lambda.Function(this, "IngestFn", {
      runtime: lambda.Runtime.PYTHON_3_12,
      architecture: lambda.Architecture.X86_64,
      handler: "handler.handler",
      code: ingestCode,
      timeout: Duration.minutes(10),
      memorySize: 512,
      logRetention: commonLogRetention,
      environment: {
        DB_SECRET_ARN: database.secret!.secretArn,
        DB_HOST: database.instanceEndpoint.hostname,
        DB_NAME: "easyrag",
        DOCUMENTS_BUCKET: documentsBucket.bucketName,
        EMBED_FUNCTION_NAME: embedFn.functionName,
        LLAMA_CLOUD_API_KEY: process.env.LLAMA_CLOUD_API_KEY || "",
      },
    });
    embedFn.grantInvoke(ingestFn);

    const apiFn = new lambdaNodejs.NodejsFunction(this, "ApiFn", {
      entry: path.join(__dirname, "../../lambdas/api/src/index.ts"),
      projectRoot: path.join(__dirname, "../../lambdas/api"),
      depsLockFilePath: path.join(__dirname, "../../lambdas/api/package-lock.json"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: Duration.minutes(5),
      memorySize: 512,
      logRetention: commonLogRetention,
      bundling: {
        minify: true,
        sourceMap: false,
        target: "node22",
        format: lambdaNodejs.OutputFormat.CJS,
        externalModules: [],
        loader: { ".sql": "text" },
      },
      environment: {
        DB_SECRET_ARN: database.secret!.secretArn,
        DB_HOST: database.instanceEndpoint.hostname,
        DB_NAME: "easyrag",
        DOCUMENTS_BUCKET: documentsBucket.bucketName,
        EMBED_FUNCTION_NAME: embedFn.functionName,
        INGEST_FUNCTION_NAME: ingestFn.functionName,
        DB_INSTANCE_ID: database.instanceIdentifier,
        ALLOWED_ORIGIN: `https://${APP_DOMAIN}`,
        COGNITO_USER_POOL_ID: userPool.userPoolId,
        COGNITO_CLIENT_ID: userPoolClient.userPoolClientId,
        COGNITO_DOMAIN: userPoolDomain.baseUrl(),
        USER_SECRET_PREFIX,
      },
    });

    apiFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "secretsmanager:CreateSecret",
          "secretsmanager:GetSecretValue",
          "secretsmanager:PutSecretValue",
          "secretsmanager:DeleteSecret",
          "secretsmanager:TagResource",
        ],
        resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:${USER_SECRET_PREFIX}/*`],
      }),
    );

    const stopFn = new lambda.Function(this, "StopRdsFn", {
      runtime: lambda.Runtime.PYTHON_3_12,
      architecture: lambda.Architecture.ARM_64,
      handler: "handler.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../../lambdas/stop_rds/.bundle")),
      timeout: Duration.seconds(30),
      memorySize: 128,
      logRetention: commonLogRetention,
      environment: {
        DB_INSTANCE_ID: database.instanceIdentifier,
      },
    });

    database.secret!.grantRead(apiFn);
    database.secret!.grantRead(ingestFn);
    database.secret!.grantRead(embedFn);
    documentsBucket.grantReadWrite(apiFn);
    documentsBucket.grantReadWrite(ingestFn);
    documentsBucket.grantRead(embedFn);
    embedFn.grantInvoke(apiFn);
    ingestFn.grantInvoke(apiFn);

    const rdsControlPolicy = new iam.PolicyStatement({
      actions: ["rds:StartDBInstance", "rds:StopDBInstance", "rds:DescribeDBInstances"],
      resources: [database.instanceArn],
    });
    apiFn.addToRolePolicy(rdsControlPolicy);
    stopFn.addToRolePolicy(rdsControlPolicy);

    const authFn = new lambdaNodejs.NodejsFunction(this, "AuthFn", {
      entry: path.join(__dirname, "../../lambdas/auth/src/index.ts"),
      projectRoot: path.join(__dirname, "../../lambdas/auth"),
      depsLockFilePath: path.join(__dirname, "../../lambdas/auth/package-lock.json"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: Duration.seconds(15),
      memorySize: 256,
      logRetention: commonLogRetention,
      bundling: {
        minify: true,
        sourceMap: false,
        target: "node22",
        format: lambdaNodejs.OutputFormat.CJS,
        externalModules: [],
      },
      environment: {
        ALLOWED_ORIGIN: `https://${APP_DOMAIN}`,
        COGNITO_USER_POOL_ID: userPool.userPoolId,
        COGNITO_CLIENT_ID: userPoolClient.userPoolClientId,
      },
    });
    authFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "cognito-idp:AdminInitiateAuth",
          "cognito-idp:AdminRespondToAuthChallenge",
          "cognito-idp:AdminUserGlobalSignOut",
          "cognito-idp:AdminGetUser",
          "cognito-idp:SignUp",
          "cognito-idp:ConfirmSignUp",
          "cognito-idp:ResendConfirmationCode",
          "cognito-idp:ForgotPassword",
          "cognito-idp:ConfirmForgotPassword",
          "cognito-idp:RevokeToken",
        ],
        resources: [userPool.userPoolArn, `${userPool.userPoolArn}/*`],
      }),
    );
    authFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "cognito-idp:SignUp",
          "cognito-idp:ConfirmSignUp",
          "cognito-idp:ResendConfirmationCode",
          "cognito-idp:ForgotPassword",
          "cognito-idp:ConfirmForgotPassword",
          "cognito-idp:RevokeToken",
        ],
        resources: ["*"],
      }),
    );

    const authApi = new apigwv2.HttpApi(this, "AuthHttpApi", {
      apiName: "contextinject-auth",
      corsPreflight: {
        allowHeaders: ["content-type", "authorization"],
        allowMethods: [apigwv2.CorsHttpMethod.POST, apigwv2.CorsHttpMethod.OPTIONS],
        allowOrigins: APP_ORIGINS,
        maxAge: Duration.hours(24),
      },
    });
    const authIntegration = new HttpLambdaIntegration("AuthIntegration", authFn);
    authApi.addRoutes({
      path: "/auth/{proxy+}",
      methods: [apigwv2.HttpMethod.POST],
      integration: authIntegration,
    });

    new scheduler.Schedule(this, "StopRdsNightly", {
      description: "Stop contextinject RDS every night; start it manually when needed",
      schedule: scheduler.ScheduleExpression.cron({
        minute: "0",
        hour: "2",
        timeZone: TimeZone.AMERICA_SAO_PAULO,
      }),
      target: new schedulerTargets.LambdaInvoke(stopFn, {
        input: scheduler.ScheduleTargetInput.fromObject({ action: "stop" }),
      }),
    });

    const apiUrl = apiFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
      cors: {
        allowedOrigins: APP_ORIGINS,
        allowedMethods: [lambda.HttpMethod.ALL],
        allowedHeaders: ["*"],
        maxAge: Duration.hours(24),
      },
    });

    const redirectLegacyHost = new cloudfront.Function(this, "RedirectLegacyHost", {
      comment: "Send easyrag.fpoiato.com to contextinject.fpoiato.com",
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  var host = request.headers.host.value;
  if (host === '${LEGACY_APP_DOMAIN}') {
    var location = 'https://${APP_DOMAIN}' + request.uri;
    if (request.querystring) {
      location += '?' + request.querystring;
    }
    return {
      statusCode: 301,
      statusDescription: 'Moved Permanently',
      headers: { location: { value: location } }
    };
  }
  return request;
}
`),
    });

    const spaOrigin = origins.S3BucketOrigin.withOriginAccessControl(frontendBucket);
    const frontendDistribution = new cloudfront.Distribution(this, "FrontendCdn", {
      comment: "contextinject SPA",
      domainNames: [APP_DOMAIN, LEGACY_APP_DOMAIN],
      certificate,
      defaultRootObject: "index.html",
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      defaultBehavior: {
        origin: spaOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
        functionAssociations: [
          {
            function: redirectLegacyHost,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: "/index.html", ttl: Duration.minutes(1) },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: "/index.html", ttl: Duration.minutes(1) },
      ],
    });

    const apiCorsPolicy = new cloudfront.ResponseHeadersPolicy(this, "ApiCors", {
      corsBehavior: {
        accessControlAllowCredentials: false,
        accessControlAllowHeaders: ["Content-Type", "Authorization"],
        accessControlAllowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        accessControlAllowOrigins: APP_ORIGINS,
        accessControlMaxAge: Duration.hours(24),
        originOverride: true,
      },
      securityHeadersBehavior: {
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: {
          referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          override: true,
        },
        strictTransportSecurity: {
          accessControlMaxAge: Duration.days(365),
          includeSubdomains: true,
          override: true,
        },
        xssProtection: { protection: true, modeBlock: true, override: true },
      },
    });

    const apiDistribution = new cloudfront.Distribution(this, "ApiCdn", {
      comment: "contextinject API",
      domainNames: [API_DOMAIN, LEGACY_API_DOMAIN],
      certificate,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      additionalBehaviors: {
        "/auth*": {
          origin: new origins.HttpOrigin(`${authApi.apiId}.execute-api.${this.region}.amazonaws.com`, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          responseHeadersPolicy: apiCorsPolicy,
        },
      },
      defaultBehavior: {
        origin: new origins.FunctionUrlOrigin(apiUrl),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        responseHeadersPolicy: apiCorsPolicy,
      },
    });

    new route53.ARecord(this, "AppAlias", {
      zone,
      recordName: "easyrag",
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(frontendDistribution)),
    });
    new route53.ARecord(this, "AppAliasCurrent", {
      zone,
      recordName: "contextinject",
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(frontendDistribution)),
    });
    new route53.ARecord(this, "ApiAlias", {
      zone,
      recordName: "api.easyrag",
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(apiDistribution)),
    });
    new route53.ARecord(this, "ApiAliasCurrent", {
      zone,
      recordName: "api.contextinject",
      target: route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(apiDistribution)),
    });

    const frontendDir = path.join(__dirname, "../../../frontend/dist/frontend/browser");
    new s3deploy.BucketDeployment(this, "FrontendDeploy", {
      sources: [s3deploy.Source.asset(frontendDir)],
      destinationBucket: frontendBucket,
      distribution: frontendDistribution,
      distributionPaths: ["/*"],
      memoryLimit: 256,
    });

    new CfnOutput(this, "AppUrl", { value: `https://${APP_DOMAIN}` });
    new CfnOutput(this, "ApiUrl", { value: `https://${API_DOMAIN}` });
    new CfnOutput(this, "DbInstance", { value: database.instanceIdentifier });
    new CfnOutput(this, "DocumentsBucketName", { value: documentsBucket.bucketName });
    new CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new CfnOutput(this, "UserPoolClientId", { value: userPoolClient.userPoolClientId });
    new CfnOutput(this, "CognitoDomain", { value: userPoolDomain.baseUrl() });
    new CfnOutput(this, "AuthApiUrl", { value: `${authApi.apiEndpoint}/auth` });
  }
}
