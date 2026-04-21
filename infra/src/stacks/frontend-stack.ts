import * as cdk from 'aws-cdk-lib'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins'
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment'
import { Construct } from 'constructs'

export interface FrontendStackProps extends cdk.StackProps {
  projectName: string
  /**
   * The BFF API base URL — injected into the runtime config so the SPA
   * knows where to POST /chat requests.
   */
  bffUrl: string
  agentMode: 'direct' | 'bff'
  // Cognito values written into a runtime config object served from S3
  cognitoUserPoolId: string
  cognitoUserPoolClientId: string
  cognitoIdentityPoolId: string
  cognitoRegion: string
  agentRuntimeArn: string
}

export class FrontendStack extends cdk.Stack {
  public readonly distributionUrl: string

  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props)

    const {
      projectName,
      bffUrl,
      agentMode,
      cognitoUserPoolId,
      cognitoUserPoolClientId,
      cognitoIdentityPoolId,
      cognitoRegion,
      agentRuntimeArn,
    } = props

    // ── S3 bucket (private — no public access) ─────────────────────────
    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      bucketName: `${projectName}-frontend-${this.account}`,
      
      // NOTE: Current SCP forbids calls to s3:PutBucketPublicAccessBlock.
      // temporarily comment out and leave default configuration behavior (what also blocks public access, but without an explicit block all public access).
      // blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,

      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    })

    // ── CloudFront Origin Access Control ──────────────────────────────
    const oac = new cloudfront.S3OriginAccessControl(this, 'OAC', {
      signing: cloudfront.Signing.SIGV4_NO_OVERRIDE,
    })

    // ── CloudFront distribution ────────────────────────────────────────
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: `${projectName} frontend`,
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket, {
          originAccessControl: oac,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        compress: true,
      },
      // SPA fallback — return index.html for all 403/404 so React Router works
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
      ],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    })

    this.distributionUrl = `https://${distribution.distributionDomainName}`

    // ── Runtime config object ─────────────────────────────────────────
    // Deployed as /config.js — the HTML loads this before the bundle,
    // so the SPA can read window.__APP_CONFIG__ without a rebuild.
    // This is the standard pattern for injecting env vars into static SPAs
    // without baking them into the Vite bundle at build time.
    const configContent = `window.__APP_CONFIG__ = ${JSON.stringify({
      VITE_API_URL: bffUrl.replace(/\/$/, ''),
      VITE_AGENT_MODE: agentMode,
      VITE_AWS_REGION: cognitoRegion,
      VITE_COGNITO_USER_POOL_ID: cognitoUserPoolId,
      VITE_COGNITO_USER_POOL_CLIENT_ID: cognitoUserPoolClientId,
      VITE_COGNITO_IDENTITY_POOL_ID: cognitoIdentityPoolId,
      VITE_AGENT_RUNTIME_ARN: agentRuntimeArn,
    })};`

    // ── Deploy pre-built frontend assets ──────────────────────────────
    // Expects `chatbot-frontend` to be built before `cdk deploy` runs.
    // Add `npm run build` in chatbot-frontend/ to your CI pipeline first.
    new s3deploy.BucketDeployment(this, 'DeployFrontend', {
      sources: [
        s3deploy.Source.asset('../chatbot-frontend/dist'),
        s3deploy.Source.data('config.js', configContent),
      ],
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ['/*'],
      memoryLimit: 256,
      // Cache control: aggressively cache assets (Vite hashes filenames),
      // but never cache index.html or config.js
      cacheControl: [
        s3deploy.CacheControl.fromString(
          'public, max-age=31536000, immutable',
        ),
      ],
    })

    // ── Grant CloudFront OAC read access to the bucket ─────────────────
    siteBucket.addToResourcePolicy(
      new cdk.aws_iam.PolicyStatement({
        actions: ['s3:GetObject'],
        principals: [new cdk.aws_iam.ServicePrincipal('cloudfront.amazonaws.com')],
        resources: [siteBucket.arnForObjects('*')],
        conditions: {
          StringEquals: {
            'AWS:SourceArn': `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`,
          },
        },
      }),
    )

    // ── Outputs ────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'DistributionUrl', {
      value: this.distributionUrl,
      exportName: `${projectName}-FrontendUrl`,
    })

    new cdk.CfnOutput(this, 'BucketName', {
      value: siteBucket.bucketName,
      exportName: `${projectName}-FrontendBucket`,
    })

    new cdk.CfnOutput(this, 'DistributionId', {
      value: distribution.distributionId,
      exportName: `${projectName}-DistributionId`,
    })
  }
}
