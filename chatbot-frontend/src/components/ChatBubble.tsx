import cavemanMascot from '@/assets/caveman-mascot.png'

export type ChatMessage = {
  id: string
  role: 'user' | 'agent'
  content: string
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
            <p className="text-sm font-semibold leading-relaxed sm:text-base">
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
          <p className="whitespace-pre-wrap text-sm font-semibold leading-relaxed sm:text-base">
            {message.content}
          </p>
        </div>
      </div>
    </div>
  )
}
