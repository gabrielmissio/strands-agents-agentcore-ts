import { useEffect, useRef, useState } from 'react'
import { Send, ShieldCheck, Sparkles } from 'lucide-react'
import { UserMenu } from './UserMenu.tsx'
import cavemanMascot from '@/assets/caveman-mascot.png'
import { ChatBubble, type ChatMessage } from './ChatBubble.tsx'
import { ThinkingBubble } from './ThinkingBubble.tsx'
import { LanguageSwitcher } from './LanguageSwitcher.tsx'
import { sendMessageBff, sendMessageDirect, AGENT_MODE } from '@/lib/api.ts'
import { useI18n } from '@/lib/i18n/context.ts'

export interface ChatExperienceProps {
  /** Shown in the header so it is obvious which account is talking to the agent. */
  userEmail?: string
  /**
   * Renders the admin badge and the link to the admin panel. Cosmetic — it reflects a
   * `cognito:groups` claim read in the browser, so it must never be the thing that gates a
   * privileged action; the BFF's admin routes re-check group membership server-side.
   */
  isAdmin?: boolean
  /** Owned by the caller — clears the Cognito session and swaps back to the auth screen. */
  onSignOut?: () => void | Promise<void>
  /** Shown only alongside `isAdmin` — switches the app to the admin panel view. */
  onOpenAdmin?: () => void
}

export function ChatExperience({ userEmail, isAdmin, onSignOut, onOpenAdmin }: ChatExperienceProps) {
  const { t } = useI18n()
  const SUGGESTIONS = [
    { icon: '🪨', label: t('chat.suggestionValidateLabel'), prompt: t('chat.suggestionValidatePrompt') },
    { icon: '💰', label: t('chat.suggestionBalanceLabel'), prompt: t('chat.suggestionBalancePrompt') },
    { icon: '🔥', label: t('chat.suggestionRateLabel'), prompt: t('chat.suggestionRatePrompt') },
    { icon: '✨', label: t('chat.suggestionLettersLabel'), prompt: t('chat.suggestionLettersPrompt') },
  ]

  const [signingOut, setSigningOut] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'agent',
      content: t('chat.welcome'),
    },
  ])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const [sessionId, setSessionId] = useState<string | undefined>()
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, thinking])

  const handleSignOut = async () => {
    if (!onSignOut || signingOut) return
    setSigningOut(true)
    try {
      await onSignOut()
    } finally {
      setSigningOut(false)
    }
  }

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
        { id: agentMsgId, role: 'agent', content: '', isStreaming: true, status: t('chat.statusConnecting'), toolsUsed: [] },
      ])

      try {
        await sendMessageDirect(trimmed, currentSessionId, {
          onToken: (token) => {
            setMessages((m) =>
              m.map((msg) =>
                msg.id === agentMsgId
                  ? { ...msg, content: msg.content + token, status: t('chat.statusStreaming') }
                  : msg,
              ),
            )
          },
          onToolStart: (toolName) => {
            if (!toolsUsed.includes(toolName)) toolsUsed.push(toolName)
            setMessages((m) =>
              m.map((msg) =>
                msg.id === agentMsgId
                  ? { ...msg, toolsUsed: [...toolsUsed], activeTool: toolName, status: t('chat.statusUsingTool', { tool: toolName }) }
                  : msg,
              ),
            )
          },
          onThinking: () => {
            setMessages((m) =>
              m.map((msg) =>
                msg.id === agentMsgId
                  ? { ...msg, status: t('chat.statusThinking') }
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
                      content: msg.content || t('chat.errorWithMessage', { message: error.message }),
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
              ? { ...msg, content: msg.content || t('chat.errorGeneric'), isStreaming: false, status: undefined }
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
        { id: agentMsgId, role: 'agent', content: '', isStreaming: true, status: t('chat.statusConnecting'), toolsUsed: [] },
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
                  ? { ...msg, content: msg.content + token, status: t('chat.statusStreaming') }
                  : msg,
              ),
            )
          },
          onToolStart: (toolName) => {
            if (!toolsUsed.includes(toolName)) toolsUsed.push(toolName)
            setMessages((m) =>
              m.map((msg) =>
                msg.id === agentMsgId
                  ? { ...msg, toolsUsed: [...toolsUsed], activeTool: toolName, status: t('chat.statusUsingTool', { tool: toolName }) }
                  : msg,
              ),
            )
          },
          onThinking: () => {
            setMessages((m) =>
              m.map((msg) =>
                msg.id === agentMsgId
                  ? { ...msg, status: t('chat.statusThinking') }
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
                      content: msg.content || t('chat.errorWithMessage', { message: error.message }),
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
              ? { ...msg, content: msg.content || t('chat.errorGeneric'), isStreaming: false, status: undefined }
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
            <img src={cavemanMascot} alt={t('chat.mascotHeaderAlt')} className="h-full w-full object-cover" />
            <span className="absolute -right-0.5 -bottom-0.5 h-3 w-3 rounded-full border-2 border-cave bg-moss" />
          </div>
          <div className="leading-tight">
            <h1 className="font-display text-lg uppercase text-cave sm:text-xl">
              {t('chat.title')}
            </h1>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t('chat.subtitle')}
            </p>
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            <LanguageSwitcher />
            {isAdmin && onOpenAdmin && (
              <button
                type="button"
                onClick={onOpenAdmin}
                title={t('chat.adminPanelTitle')}
                className="flex h-9 items-center gap-1.5 rounded-xl border-[3px] border-cave bg-fire px-3 font-display text-[10px] uppercase tracking-wider text-fire-foreground shadow-[var(--shadow-stone)] transition active:translate-y-0.5 active:shadow-none"
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                {t('chat.adminLink')}
              </button>
            )}
            {onSignOut && (
              <UserMenu email={userEmail} onSignOut={handleSignOut} signingOut={signingOut} />
            )}
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
              placeholder={t('chat.inputPlaceholder')}
              className="flex-1 bg-transparent text-sm font-semibold text-cave placeholder:text-cave/50 focus:outline-none sm:text-base"
              autoFocus
            />
          </div>
          <button
            type="submit"
            disabled={!input.trim() || thinking}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border-[3px] border-cave bg-fire text-fire-foreground shadow-[var(--shadow-stone)] transition active:translate-y-0.5 active:shadow-none disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={t('chat.send')}
          >
            <Send className="h-5 w-5" />
          </button>
        </form>
        <p className="pb-2 text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('chat.footer')}
        </p>
      </footer>
    </div>
  )
}
