/**
 * Streaming event types emitted by AgentCore.
 *
 * Based on the Strands SDK / Bedrock AgentCore streaming protocol:
 * - contentBlockDelta → token-by-token text
 * - contentBlockStart → tool use begin
 * - messageStop       → loop transition or end_turn
 */

export interface StreamCallbacks {
  /** Called for each text token (token-by-token). */
  onToken: (text: string) => void
  /** Called when a tool starts executing. */
  onToolStart: (toolName: string) => void
  /** Called when the model begins thinking (reasoning). */
  onThinking: (text: string) => void
  /** Called with a status label (e.g. "Using calculator", "Streaming..."). */
  onStatus: (status: string) => void
  /** Called when the stream completes. */
  onComplete: () => void
  /** Called on error. */
  onError: (error: Error) => void
}

/**
 * Parses a streaming response from AgentCore and dispatches callbacks.
 */
export async function parseAgentCoreStream(
  response: Response,
  callbacks: StreamCallbacks,
): Promise<void> {
  if (!response.body) {
    callbacks.onError(new Error('Response has no body'))
    return
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let isInThinking = false

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue

        // Strip SSE "data: " prefix
        let jsonString = line
        if (line.startsWith('data: ')) {
          jsonString = line.substring(6)
        }

        if (jsonString === '[DONE]') continue

        // Skip noise lines (Python repr, control events)
        if (jsonString.startsWith("\"{'") || jsonString.startsWith("{'")) continue
        if (jsonString.includes('"init_event_loop"') || jsonString.includes('"start": true')) continue

        let chunk: Record<string, unknown>
        try {
          chunk = JSON.parse(jsonString)
        } catch {
          continue
        }

        // --- AgentCore JSON envelope (non-streaming agent.invoke() response) ---
        const agentResponse = chunk.response as Record<string, unknown> | undefined
        if (agentResponse?.type === 'agentResult') {
          const lastMessage = agentResponse.lastMessage as Record<string, unknown> | undefined
          const content = lastMessage?.content as Array<Record<string, string>> | undefined
          if (content) {
            for (const block of content) {
              if (block.text) {
                callbacks.onToken(block.text)
              }
            }
          }
          callbacks.onComplete()
          continue
        }

        // --- Text streaming (token by token) ---
        const delta = (chunk.event as Record<string, unknown>)?.contentBlockDelta as Record<string, unknown> | undefined
        if (delta) {
          const text = (delta.delta as Record<string, string>)?.text
          if (text) {
            // Detect <thinking> tags
            if (text.includes('<thinking') && !isInThinking) {
              isInThinking = true
              callbacks.onStatus('Thinking...')
            }

            if (isInThinking) {
              callbacks.onThinking(text)
              if (text.includes('</thinking>')) {
                isInThinking = false
                callbacks.onStatus('Streaming...')
              }
            } else {
              callbacks.onToken(text)
            }
          }
          continue
        }

        // --- Tool call starting ---
        const blockStart = (chunk.event as Record<string, unknown>)?.contentBlockStart as Record<string, unknown> | undefined
        if (blockStart) {
          const toolUse = (blockStart.start as Record<string, unknown>)?.toolUse as Record<string, string> | undefined
          if (toolUse?.name) {
            callbacks.onToolStart(toolUse.name)
            callbacks.onStatus(`Using ${toolUse.name}`)
          }
          continue
        }

        // --- Message stop (loop transition or final) ---
        const messageStop = (chunk.event as Record<string, unknown>)?.messageStop as Record<string, string> | undefined
        if (messageStop) {
          if (messageStop.stopReason === 'end_turn') {
            callbacks.onComplete()
          } else {
            callbacks.onStatus('Processing...')
          }
          continue
        }

        // --- Tool stream event (subagent streaming) ---
        if (chunk.tool_stream_event) {
          const toolEvent = chunk.tool_stream_event as Record<string, unknown>
          const toolUseInfo = toolEvent.tool_use as Record<string, string> | undefined
          const streamData = toolEvent.data as Record<string, unknown> | undefined

          if (toolUseInfo?.name) {
            callbacks.onStatus(`${toolUseInfo.name}: working...`)
          }

          if (streamData?.data && typeof streamData.data === 'string') {
            callbacks.onToken(streamData.data)
          }

          if (streamData?.result) {
            callbacks.onStatus('Processing result...')
          }
          continue
        }
      }
    }

    // Process any remaining data left in the buffer (e.g. single JSON response with no trailing newline)
    if (buffer.trim()) {
      let jsonString = buffer.trim()
      if (jsonString.startsWith('data: ')) {
        jsonString = jsonString.substring(6)
      }
      try {
        const chunk = JSON.parse(jsonString) as Record<string, unknown>
        const agentResponse = chunk.response as Record<string, unknown> | undefined
        if (agentResponse?.type === 'agentResult') {
          const lastMessage = agentResponse.lastMessage as Record<string, unknown> | undefined
          const content = lastMessage?.content as Array<Record<string, string>> | undefined
          if (content) {
            for (const block of content) {
              if (block.text) {
                callbacks.onToken(block.text)
              }
            }
          }
        }
      } catch {
        // Not valid JSON, ignore
      }
    }

    callbacks.onComplete()
  } catch (err) {
    callbacks.onError(err instanceof Error ? err : new Error(String(err)))
  } finally {
    reader.releaseLock()
  }
}
