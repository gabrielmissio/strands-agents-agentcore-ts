import { useEffect, useRef, useState } from 'react'
import { Send, Sparkles } from 'lucide-react'
import cavemanMascot from '@/assets/caveman-mascot.png'
import { ChatBubble, type ChatMessage } from './ChatBubble.tsx'
import { ThinkingBubble } from './ThinkingBubble.tsx'
import { sendMessageBff, sendMessageDirect, AGENT_MODE } from '@/lib/api.ts'

const SUGGESTIONS = [
  { icon: '🪨', label: 'Validate address', prompt: 'Validate 0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0' },
  { icon: '💰', label: 'Get balance', prompt: "What's the balance of vitalik.eth?" },
  { icon: '🔥', label: 'Exchange rate', prompt: 'ETH to USD rate?' },
  { icon: '✨', label: 'Count letters', prompt: 'How many times does the letter "s" appear in "satoshi nakamoto\'s secret"?' },
]

export function ChatExperience() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'agent',
      content: 'OOK OOK! Me CAVEMAN. Me help with shiny blockchain rocks. Ask me anything!',
    },
  ])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const [sessionId, setSessionId] = useState<string | undefined>()
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, thinking])

  const send = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || thinking) return

    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: trimmed }
    setMessages((m) => [...m, userMsg])
    setInput('')
    setThinking(true)

    // Ensure we have a session id
    const currentSessionId = sessionId ?? crypto.randomUUID()
    if (!sessionId) setSessionId(currentSessionId)

    if (AGENT_MODE === 'direct') {
      // ── Direct-to-AgentCore (streaming) ──
      const agentMsgId = crypto.randomUUID()
      const toolsUsed: string[] = []

      // Add placeholder streaming message
      setMessages((m) => [
        ...m,
        { id: agentMsgId, role: 'agent', content: '', isStreaming: true, status: 'Connecting...', toolsUsed: [] },
      ])

      try {
        await sendMessageDirect(trimmed, currentSessionId, {
          onToken: (token) => {
            setMessages((m) =>
              m.map((msg) =>
                msg.id === agentMsgId
                  ? { ...msg, content: msg.content + token, status: 'Streaming...' }
                  : msg,
              ),
            )
          },
          onToolStart: (toolName) => {
            if (!toolsUsed.includes(toolName)) toolsUsed.push(toolName)
            setMessages((m) =>
              m.map((msg) =>
                msg.id === agentMsgId
                  ? { ...msg, toolsUsed: [...toolsUsed], activeTool: toolName, status: `Using ${toolName}` }
                  : msg,
              ),
            )
          },
          onThinking: () => {
            setMessages((m) =>
              m.map((msg) =>
                msg.id === agentMsgId
                  ? { ...msg, status: 'Thinking...' }
                  : msg,
              ),
            )
          },
          onStatus: (status) => {
            setMessages((m) =>
              m.map((msg) =>
                msg.id === agentMsgId ? { ...msg, status } : msg,
              ),
            )
          },
          onComplete: () => {
            setMessages((m) =>
              m.map((msg) =>
                msg.id === agentMsgId
                  ? { ...msg, isStreaming: false, activeTool: undefined, status: undefined }
                  : msg,
              ),
            )
          },
          onError: (error) => {
            setMessages((m) =>
              m.map((msg) =>
                msg.id === agentMsgId
                  ? {
                      ...msg,
                      content: msg.content || `UGH! ${error.message}`,
                      isStreaming: false,
                      activeTool: undefined,
                      status: undefined,
                    }
                  : msg,
              ),
            )
          },
        })
      } catch {
        setMessages((m) =>
          m.map((msg) =>
            msg.id === agentMsgId
              ? { ...msg, content: msg.content || 'UGH! Rock fall on head. Me no can answer right now. Try again!', isStreaming: false, status: undefined }
              : msg,
          ),
        )
      } finally {
        setThinking(false)
      }
    } else {
      // ── BFF mode (SSE streaming) ──
      const agentMsgId = crypto.randomUUID()
      const toolsUsed: string[] = []

      // Add placeholder streaming message
      setMessages((m) => [
        ...m,
        { id: agentMsgId, role: 'agent', content: '', isStreaming: true, status: 'Connecting...', toolsUsed: [] },
      ])

      try {
        await sendMessageBff(trimmed, currentSessionId, {
          onSessionId: (newSessionId) => {
            setSessionId(newSessionId)
          },
          onToken: (token) => {
            setMessages((m) =>
              m.map((msg) =>
                msg.id === agentMsgId
                  ? { ...msg, content: msg.content + token, status: 'Streaming...' }
                  : msg,
              ),
            )
          },
          onToolStart: (toolName) => {
            if (!toolsUsed.includes(toolName)) toolsUsed.push(toolName)
            setMessages((m) =>
              m.map((msg) =>
                msg.id === agentMsgId
                  ? { ...msg, toolsUsed: [...toolsUsed], activeTool: toolName, status: `Using ${toolName}` }
                  : msg,
              ),
            )
          },
          onThinking: () => {
            setMessages((m) =>
              m.map((msg) =>
                msg.id === agentMsgId
                  ? { ...msg, status: 'Thinking...' }
                  : msg,
              ),
            )
          },
          onStatus: (status) => {
            setMessages((m) =>
              m.map((msg) =>
                msg.id === agentMsgId ? { ...msg, status } : msg,
              ),
            )
          },
          onComplete: () => {
            setMessages((m) =>
              m.map((msg) =>
                msg.id === agentMsgId
                  ? { ...msg, isStreaming: false, activeTool: undefined, status: undefined }
                  : msg,
              ),
            )
          },
          onError: (error) => {
            setMessages((m) =>
              m.map((msg) =>
                msg.id === agentMsgId
                  ? {
                      ...msg,
                      content: msg.content || `UGH! ${error.message}`,
                      isStreaming: false,
                      activeTool: undefined,
                      status: undefined,
                    }
                  : msg,
              ),
            )
          },
        })
      } catch {
        setMessages((m) =>
          m.map((msg) =>
            msg.id === agentMsgId
              ? { ...msg, content: msg.content || 'UGH! Rock fall on head. Me no can answer right now. Try again!', isStreaming: false, status: undefined }
              : msg,
          ),
        )
      } finally {
        setThinking(false)
      }
    }
  }

  return (
    <div className="flex h-[100dvh] flex-col">
      {/* Header */}
      <header className="relative z-10 border-b-[3px] border-cave/80 bg-secondary/60 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-3">
          <div className="relative h-11 w-11 overflow-hidden rounded-full border-[3px] border-cave bg-bone shadow-[var(--shadow-stone)]">
            <img src={cavemanMascot} alt="Caveman mascot" className="h-full w-full object-cover" />
            <span className="absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full border-2 border-cave bg-moss" />
          </div>
          <div className="leading-tight">
            <h1 className="font-display text-lg uppercase text-cave sm:text-xl">
              Web3 Caveman
            </h1>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Powered by Bedrock AgentCore
            </p>
          </div>
        </div>
      </header>

      {/* Messages */}
      <main ref={scrollRef} className="cave-texture relative flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6">
          {messages.map((m, i) => (
            <ChatBubble key={m.id} message={m} isFirstAgent={i === 0} />
          ))}
          {thinking && <ThinkingBubble />}

          {messages.length === 1 && !thinking && (
            <div className="mt-2 grid grid-cols-2 gap-2 sm:gap-3">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => send(s.prompt)}
                  className="group flex items-center gap-2 rounded-2xl border-[3px] border-cave bg-card px-3 py-3 text-left text-sm font-semibold text-card-foreground shadow-[var(--shadow-stone)] transition hover:bg-secondary active:translate-y-0.5 active:shadow-none"
                >
                  <span className="text-xl">{s.icon}</span>
                  <span className="leading-tight">{s.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Input */}
      <footer className="relative z-10 border-t-[3px] border-cave/80 bg-secondary/70 backdrop-blur">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            send(input)
          }}
          className="mx-auto flex max-w-3xl items-end gap-2 px-3 py-3 sm:px-4"
        >
          <div className="stone-tablet flex flex-1 items-center gap-2 px-3 py-2">
            <Sparkles className="h-4 w-4 shrink-0 text-cave/70" />
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask caveman about wallet, balance, address…"
              className="flex-1 bg-transparent text-sm font-semibold text-cave placeholder:text-cave/50 focus:outline-none sm:text-base"
              autoFocus
            />
          </div>
          <button
            type="submit"
            disabled={!input.trim() || thinking}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border-[3px] border-cave bg-fire text-fire-foreground shadow-[var(--shadow-stone)] transition active:translate-y-0.5 active:shadow-none disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Send"
          >
            <Send className="h-5 w-5" />
          </button>
        </form>
        <p className="pb-2 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          🦴 Strands Agents + Amazon Bedrock AgentCore 🦴
        </p>
      </footer>
    </div>
  )
}
