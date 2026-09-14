#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { EasyRagStack } from "../lib/easyrag-stack";

const app = new cdk.App();
new EasyRagStack(app, "EasyRagStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || "us-east-1",
  },
  description: "easyRAG — low-cost RAG chat with pgvector and scheduled RDS stop",
});
