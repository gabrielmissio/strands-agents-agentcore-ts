import cavemanMascot from '@/assets/caveman-mascot.png'
import { ToolBadgeList } from './ToolBadge'

export type ChatMessage = {
  id: string
  role: 'user' | 'agent'
  content: string
  /** Tool names used by the agent during this response. */
  toolsUsed?: string[]
  /** Currently active tool (while streaming). */
  activeTool?: string
  /** Whether the message is still being streamed. */
  isStreaming?: boolean
  /** Status label (e.g. "Using calculator"). */
  status?: string
}

export function ChatBubble({
  message,
  isFirstAgent,
}: {
  message: ChatMessage
  isFirstAgent?: boolean
}) {
  if (message.role === 'user') {
    return (
      <div className="flex animate-bubble-in justify-end">
        <div className="relative max-w-[80%]">
          <div className="bubble-user">
            <div className="bubble-user-tail" />
            <div className="bubble-user-tail-inner" />
            <p className="break-words text-sm font-semibold leading-relaxed sm:text-base">
              {message.content}
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex animate-bubble-in items-end gap-2 sm:gap-3">
      <div
        className={`relative h-12 w-12 shrink-0 overflow-hidden rounded-full border-[3px] border-cave bg-bone shadow-[var(--shadow-stone)] sm:h-14 sm:w-14 ${
          isFirstAgent ? 'animate-mascot' : ''
        }`}
      >
        <img src={cavemanMascot} alt="Caveman" className="h-full w-full object-cover" />
      </div>
      <div className="relative max-w-[80%]">
        <div className="bubble-caveman">
          <div className="bubble-caveman-tail" />
          <div className="bubble-caveman-tail-inner" />
          <p className="whitespace-pre-wrap break-words text-sm font-semibold leading-relaxed sm:text-base">
            {message.content}
            {message.isStreaming && <span className="ml-0.5 inline-block w-1.5 animate-pulse text-fire">▌</span>}
          </p>
          {message.toolsUsed && message.toolsUsed.length > 0 && (
            <ToolBadgeList tools={message.toolsUsed} activeTool={message.activeTool} />
          )}
          {message.status && message.isStreaming && (
            <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-cave/50">
              {message.status}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
