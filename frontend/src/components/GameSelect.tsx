interface GameSelectProps {
  /** Distinct id for the select, so its label points at it. */
  id: string;
  /** How many games the job played. */
  count: number;
  /** The selected game, counted from 0. */
  value: number;
  onChange: (game: number) => void;
  className?: string;
}

/** Picks one game of a job; hidden when there is only one. */
export function GameSelect({ id, count, value, onChange, className = '' }: GameSelectProps) {
  if (count <= 1) return null;
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <label htmlFor={id} className="text-sm text-gray-400">Game:</label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="bg-gray-700 text-white text-sm rounded px-2 py-1"
      >
        {Array.from({ length: count }, (_, i) => (
          <option key={i} value={i}>Game {i + 1}</option>
        ))}
      </select>
    </div>
  );
}
