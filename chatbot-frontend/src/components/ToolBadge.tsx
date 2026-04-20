const TOOL_META: Record<string, { icon: string; label: string }> = {
  calculator: { icon: '🧮', label: 'Calculator' },
  letterCounter: { icon: '🔤', label: 'Letter Counter' },
  evmBalance: { icon: '💰', label: 'EVM Balance' },
  convert_crypto_units: { icon: '🔄', label: 'Convert Units' },
  validate_address: { icon: '🪨', label: 'Validate Address' },
  vanity_address: { icon: '✨', label: 'Vanity Address' },
  get_coin_price: { icon: '📈', label: 'Coin Price' },
  get_multiple_coin_prices: { icon: '📊', label: 'Multi Prices' },
  search_coin: { icon: '🔍', label: 'Search Coin' },
  get_animal_table: { icon: '🐾', label: 'Animal Table' },
  interpret: { icon: '🔮', label: 'Interpret' },
  interpret_dream: { icon: '💤', label: 'Dream Analysis' },
  generate_daily_tips: { icon: '🎯', label: 'Daily Tips' },
  analyze_numerology: { icon: '🔢', label: 'Numerology' },
}

function getMeta(toolName: string) {
  return TOOL_META[toolName] ?? { icon: '🔧', label: toolName }
}

export function ToolBadge({ name, active }: { name: string; active?: boolean }) {
  const { icon, label } = getMeta(name)

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border-2 border-cave/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
        active
          ? 'animate-pulse bg-fire/20 text-cave'
          : 'bg-bone text-cave/70'
      }`}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </span>
  )
}

export function ToolBadgeList({ tools, activeTool }: { tools: string[]; activeTool?: string }) {
  if (tools.length === 0) return null

  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {tools.map((t) => (
        <ToolBadge key={t} name={t} active={t === activeTool} />
      ))}
    </div>
  )
}
