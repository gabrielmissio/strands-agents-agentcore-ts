import {
  BedrockAgentCoreClient,
  InvokeAgentRuntimeCommand,
} from '@aws-sdk/client-bedrock-agentcore'

const client = new BedrockAgentCoreClient({
  region: process.env.AWS_REGION || 'us-east-1',
})

export async function invokeAgent(input: {
  message: string
  sessionId: string
  agentRuntimeArn: string
}): Promise<string> {
  const command = new InvokeAgentRuntimeCommand({
    runtimeSessionId: input.sessionId,
    agentRuntimeArn: input.agentRuntimeArn,
    qualifier: 'DEFAULT',
    payload: new TextEncoder().encode(input.message),
  })

  const response = await client.send(command)
  const text = await response?.response?.transformToString()

  return text ?? ''
}
