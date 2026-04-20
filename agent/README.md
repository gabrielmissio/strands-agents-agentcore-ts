# Agent

## Test locally

### Install dependencies and setup env vars

```bash
npm install
cp .env.example .env
```

### Start HTTP MCP Server

```bash
npm run mcp:http
```

### Start `Caveman Web3 Agent` locally

```bash
npm run dev
```

### Send a request to `caveman`


```bash
curl --location 'http://localhost:8080/invocations' \
    --header 'Content-Type: application/octet-stream' \
    --data 'how many time the letter `s` apperns in the sentence: satoshi nakamoto'\''s secret'
```

or


```bash
curl --location 'http://localhost:8080/invocations' \
    --header 'Content-Type: application/octet-stream' \
    --data 'generate a address that starts with `0xde` than count how many times the letter `d` appears in the address.'
```

## Test locally (with Docker)

### Build the image

```bash
docker build -t poc-strands-agents-ts .
```

### Run the container

> The agent connects to the HTTP MCP server running on your host machine.
> On Linux, use `--add-host` to expose the host as `host.docker.internal`.

```bash
docker run -p 8082:8080 \
  --add-host=host.docker.internal:host-gateway \
  -e EXCHANGE_RATE_MCP_URL=http://host.docker.internal:8081/mcp \
  poc-strands-agents-ts
```

### Test in another terminal

```bash
curl http://localhost:8082/ping
```

## Deploying to Amazon Bedrock AgentCore Runtime

### Create IAM Role

#### Make the script executable

```bash
chmod +x create-iam-role.sh
```

#### Run the script

```bash
./create-iam-role.sh
```

#### Or specify a different region

```bash
AWS_REGION=us-east-1 ./create-iam-role.sh
```

### Deploy to AWS


#### Set Environment Variables

```bash
export ACCOUNTID=$(aws sts get-caller-identity --query Account --output text)

export AWS_REGION=us-east-1

export ROLE_ARN=$(aws iam get-role \
  --role-name PocStrandsAgentsBedrockAgentCoreRuntimeRole \
  --query 'Role.Arn' \
  --output text)

export ECR_REPO=poc-strands-agents-bedrock-agent-core-ts

echo accountId: $ACCOUNTID
echo aws region: $AWS_REGION
echo runtime role: $ROLE_ARN
```

#### Create ECR Repository

```bash
aws ecr create-repository \
  --repository-name ${ECR_REPO} \
  --region ${AWS_REGION}
```

#### Login to ECR

```bash
aws ecr get-login-password --region ${AWS_REGION} | \
  docker login --username AWS --password-stdin \
  ${ACCOUNTID}.dkr.ecr.${AWS_REGION}.amazonaws.com
```

#### Build, Tag, and Push

```bash
docker build -t ${ECR_REPO} .

docker tag ${ECR_REPO}:latest \
  ${ACCOUNTID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}:latest

docker push ${ACCOUNTID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}:latest
```

#### I dont have arm64 platform

```bash
# One-time setup: enable QEMU emulation for cross-platform builds
docker run --privileged --rm tonistiigi/binfmt --install arm64

# Build targeting arm64
docker buildx build --platform linux/arm64 -t ${ECR_REPO} --load .
```

```bash
docker tag ${ECR_REPO}:latest ${ACCOUNTID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}:latest
docker push ${ACCOUNTID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}:latest
```


#### Create AgentCore Runtime

> Set `EXCHANGE_RATE_MCP_URL` if your HTTP MCP server is publicly accessible (e.g. deployed to a URL).
> If omitted, the agent will start without the coin price tools.

```bash
aws bedrock-agentcore-control create-agent-runtime \
  --agent-runtime-name poc-strands-agents-ts \
  --agent-runtime-artifact containerConfiguration={containerUri=${ACCOUNTID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}:latest} \
  --role-arn ${ROLE_ARN} \
  --network-configuration networkMode=PUBLIC \
  --protocol-configuration serverProtocol=HTTP \
  --region ${AWS_REGION}
  
#   --environment-variables EXCHANGE_RATE_MCP_URL=https://<your-mcp-server-url>/mcp \
```

#### Verify Deployment Status

```bash 
# update -XXXXXXXXXX with actually value...
export AGENT_RUNTIME_ID="poc-strands-agents-ts-XXXXXXXXXX"
```

```bash
aws bedrock-agentcore-control get-agent-runtime \
  --agent-runtime-id ${AGENT_RUNTIME_ID} \
  --region ${AWS_REGION} \
  --query 'status' \
  --output text
```

#### Update AgentCore Runtime (after pushing a new image)

Pushing a new image to ECR does **not** trigger an automatic redeployment.
You must call `update-agent-runtime` to apply the new image:

```bash
aws bedrock-agentcore-control update-agent-runtime \
  --agent-runtime-id ${AGENT_RUNTIME_ID} \
  --agent-runtime-artifact containerConfiguration={containerUri=${ACCOUNTID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}:latest} \
  --role-arn ${ROLE_ARN} \
  --network-configuration networkMode=PUBLIC \
  --region ${AWS_REGION}
```

#### Configure JWT Authorization (Cognito)

By default the runtime uses SigV4 (IAM) auth. To allow the frontend to call the agent directly with a Cognito JWT token, configure the `customJWTAuthorizer`:

1. **Get your Cognito values** (from the `infra/` CDK stack outputs):
   - `DISCOVERY_URL` — OIDC discovery URL (e.g. `https://cognito-idp.<region>.amazonaws.com/<user-pool-id>/.well-known/openid-configuration`)
   - `CLIENT_ID` — Cognito User Pool Client ID

2. **Update the runtime** with JWT authorizer:

```bash
aws bedrock-agentcore-control update-agent-runtime \
  --agent-runtime-id ${AGENT_RUNTIME_ID} \
  --agent-runtime-artifact containerConfiguration={containerUri=${ACCOUNTID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}:latest} \
  --role-arn ${ROLE_ARN} \
  --network-configuration networkMode=PUBLIC \
  --authorizer-configuration '{"customJWTAuthorizer":{"discoveryUrl":"'"${DISCOVERY_URL}"'","allowedClients":["'"${CLIENT_ID}"'"]}}' \
  --environment-variables '{"BEDROCK_MODEL_ID":"amazon.nova-pro-v1:0"}' \
  --region ${AWS_REGION}
```

> **Important:**
> - Use `allowedClients` (not `allowedAudience`). Cognito access tokens carry the client ID in the `client_id` claim, not `aud`.
> - Always include `--environment-variables` in every update call — omitting it will **clear** all env vars from the runtime.

#### Update environment variables (e.g. change the model)

Use `--environment-variables` on `update-agent-runtime`. Note: this is a **full replacement** — include every variable you want to keep.

```bash
aws bedrock-agentcore-control update-agent-runtime \
  --agent-runtime-id ${AGENT_RUNTIME_ID} \
  --agent-runtime-artifact containerConfiguration={containerUri=${ACCOUNTID}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO}:latest} \
  --role-arn ${ROLE_ARN} \
  --network-configuration networkMode=PUBLIC \
  --environment-variables BEDROCK_MODEL_ID=amazon.nova-pro-v1:0 \
  --region ${AWS_REGION}
```

Then wait for the status to return to `READY`:

```bash
aws bedrock-agentcore-control get-agent-runtime \
  --agent-runtime-id ${AGENT_RUNTIME_ID} \
  --region ${AWS_REGION} \
  --query 'status' \
  --output text
```
