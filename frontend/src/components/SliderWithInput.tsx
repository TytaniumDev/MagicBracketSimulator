import { memo } from 'react';
import { ticks } from 'd3-array';

function scaleLabels(min: number, max: number): number[] {
  const t = ticks(min, max, 4);
  const filtered = t.filter((v: number) => v >= min && v <= max);
  const result = [...new Set([min, ...filtered, max])];
  return result.sort((a, b) => a - b);
}

interface SliderWithInputProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  className?: string;
}

export const SliderWithInput = memo(function SliderWithInput({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  className = '',
}: SliderWithInputProps) {
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = parseInt(e.target.value, 10);
    if (!isNaN(v)) {
      // Snap to nearest step and clamp to [min, max]
      const snapped = step > 1 ? Math.round(v / step) * step : v;
      const clamped = Math.min(max, Math.max(min, snapped));
      onChange(clamped);
    }
  };

  const labels = scaleLabels(min, max);

  return (
    <div className={className}>
      <label className="block text-sm font-medium text-gray-300 mb-2">
        {label}:{' '}
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={handleInputChange}
          className="w-16 px-2 py-0.5 ml-1 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="w-full accent-blue-500"
      />
      <div className="flex justify-between text-xs text-gray-500 mt-1">
        {labels.map((n) => (
          <span key={n}>{n}</span>
        ))}
      </div>
    </div>
  );
});
