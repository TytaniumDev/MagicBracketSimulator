export function getEventColor(eventType: string | undefined): string {
  switch (eventType) {
    case 'spell_cast':
      return '#60a5fa'; // blue-400
    case 'spell_cast_high_cmc':
      return '#a78bfa'; // violet-400
    case 'land_played':
      return '#34d399'; // emerald-400
    case 'life_change':
      return '#f87171'; // red-400
    case 'win_condition':
      return '#4ade80'; // green-400
    case 'zone_change_gy_to_bf':
      return '#fbbf24'; // amber-400
    case 'commander_cast':
      return '#c084fc'; // purple-400
    case 'draw_extra':
      return '#22d3ee'; // cyan-400
    case 'combat':
      return '#fb923c'; // orange-400
    default:
      return '#6b7280'; // gray-500
  }
}
