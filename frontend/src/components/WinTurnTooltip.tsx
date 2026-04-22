interface WinTurnTooltipProps {
  histogram: number[];
  avgWinTurn: number;
  totalWins: number;
}

const BIN_LABELS = [
  '1', '2', '3', '4', '5', '6', '7', '8',
  '9', '10', '11', '12', '13', '14', '15', '16+',
];

export function WinTurnTooltip({ histogram, avgWinTurn, totalWins }: WinTurnTooltipProps) {
  const max = Math.max(...histogram, 1);
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-20 w-64 rounded-md border border-gray-700 bg-gray-900 p-3 shadow-lg"
    >
      <div className="mb-2 text-xs text-gray-300">
        Avg: <span className="font-mono text-white">{avgWinTurn.toFixed(1)}</span>
        <span className="text-gray-500"> · </span>
        <span>{totalWins} wins</span>
      </div>
      <div className="flex h-20 items-end gap-0.5">
        {histogram.map((count, i) => {
          const pct = (count / max) * 100;
          return (
            <div key={i} className="flex flex-1 items-end">
              <div
                data-testid="win-turn-bar"
                className="w-full rounded-sm bg-blue-500"
                style={{ height: `${pct}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-0.5 text-[9px] text-gray-500">
        {BIN_LABELS.map((label, i) => (
          <div key={i} className="flex-1 text-center">{label}</div>
        ))}
      </div>
    </div>
  );
}
