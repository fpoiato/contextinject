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
  aws_s3_notifications as s3n,
  aws_scheduler as scheduler,
  aws_scheduler_targets as schedulerTargets,
} from "aws-cdk-lib";
import { Construct } from "constructs";

const APP_DOMAIN = "easyrag.fpoiato.com";
const API_DOMAIN = "api.easyrag.fpoiato.com";
const ZONE_NAME = "fpoiato.com";
const ZONE_ID = "Z094351536ZBINA5SU45F";

export class EasyRagStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const zone = route53.HostedZone.fromHostedZoneAttributes(this, "Zone", {
      hostedZoneId: ZONE_ID,
      zoneName: ZONE_NAME,
    });

    const certificate = new acm.Certificate(this, "Cert", {
      domainName: APP_DOMAIN,
      subjectAlternativeNames: [API_DOMAIN],
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
      description: "easyRAG PostgreSQL",
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
          allowedOrigins: [`https://${APP_DOMAIN}`, "http://localhost:4200"],
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
        OPENROUTER_API_KEY: process.env.openrouter || process.env.OPENROUTER || "",
      },
    });

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

    documentsBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(ingestFn),
      { prefix: "uploads/" },
    );

    new scheduler.Schedule(this, "StopRdsNightly", {
      description: "Stop easyRAG RDS every night; start it manually when needed",
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
        allowedOrigins: [`https://${APP_DOMAIN}`, "http://localhost:4200"],
        allowedMethods: [lambda.HttpMethod.ALL],
        allowedHeaders: ["*"],
        maxAge: Duration.hours(24),
      },
    });

    const spaOrigin = origins.S3BucketOrigin.withOriginAccessControl(frontendBucket);
    const frontendDistribution = new cloudfront.Distribution(this, "FrontendCdn", {
      comment: "easyRAG SPA",
      domainNames: [APP_DOMAIN],
      certificate,
      defaultRootObject: "index.html",
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      defaultBehavior: {
        origin: spaOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        compress: true,
      },
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: "/index.html", ttl: Duration.minutes(1) },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: "/index.html", ttl: Duration.minutes(1) },
      ],
    });

    const apiCorsPolicy = new cloudfront.ResponseHeadersPolicy(this, "ApiCors", {
      corsBehavior: {
        accessControlAllowCredentials: false,
        accessControlAllowHeaders: [
          "Content-Type",
          "Authorization",
          "X-Api-Key",
          "X-User-Id",
          "X-Model",
          "X-Provider",
        ],
        accessControlAllowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        accessControlAllowOrigins: [`https://${APP_DOMAIN}`, "http://localhost:4200"],
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
      comment: "easyRAG API",
      domainNames: [API_DOMAIN],
      certificate,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
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
    new route53.ARecord(this, "ApiAlias", {
      zone,
      recordName: "api.easyrag",
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
  }
}
