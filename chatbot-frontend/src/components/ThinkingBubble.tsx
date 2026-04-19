import cavemanMascot from '@/assets/caveman-mascot.png'

export function ThinkingBubble() {
  return (
    <div className="flex animate-bubble-in items-end gap-2 sm:gap-3">
      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full border-[3px] border-cave bg-bone shadow-[var(--shadow-stone)] sm:h-14 sm:w-14">
        <img src={cavemanMascot} alt="Caveman thinking" className="h-full w-full object-cover" />
      </div>
      <div className="relative">
        <div className="bubble-caveman flex items-center gap-1.5 py-3">
          <div className="bubble-caveman-tail" />
          <div className="bubble-caveman-tail-inner" />
          <span className="h-2.5 w-2.5 rounded-full bg-cave animate-thinking" style={{ animationDelay: '0s' }} />
          <span className="h-2.5 w-2.5 rounded-full bg-cave animate-thinking" style={{ animationDelay: '0.2s' }} />
          <span className="h-2.5 w-2.5 rounded-full bg-cave animate-thinking" style={{ animationDelay: '0.4s' }} />
          <span className="ml-2 text-xs font-bold uppercase tracking-wider text-cave/70">
            Me think…
          </span>
        </div>
      </div>
    </div>
  )
}
