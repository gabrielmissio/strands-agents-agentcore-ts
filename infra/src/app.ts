#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib'
import { AuthStack } from './auth-stack.js'

const app = new cdk.App()

const projectName = app.node.tryGetContext('projectName') ?? 'web3-caveman'

new AuthStack(app, `${projectName}-auth`, {
  projectName,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? process.env.AWS_REGION ?? 'us-east-1',
  },
})
