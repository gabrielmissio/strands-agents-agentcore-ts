import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from '@aws-sdk/client-bedrock-agentcore'
import { randomUUID } from 'node:crypto'

const agentRuntimeArn = process.env.AGENT_RUNTIME_ARN
if (!agentRuntimeArn) {
  console.error('Error: AGENT_RUNTIME_ARN environment variable is not set.')
  process.exit(1)
}

const input_text =  "Tell me what tools/skills you have and can use to help me."

const client = new BedrockAgentCoreClient({
  region: process.env.AWS_REGION || 'us-east-1',
})

const input = {
  runtimeSessionId: randomUUID(),
  agentRuntimeArn: agentRuntimeArn,
  qualifier: 'DEFAULT',
  payload: new TextEncoder().encode(input_text),
}

const command = new InvokeAgentRuntimeCommand(input)
const response = await client.send(command)
const textResponse = await response?.response?.transformToString()

console.log('Response:', textResponse)
