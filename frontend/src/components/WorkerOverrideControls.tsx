import { useState } from 'react';
import type { WorkerInfo } from '../types/worker';
import { updateWorkerOverride } from '../api';

interface WorkerOverrideControlsProps {
  worker: WorkerInfo;
  onRefresh?: () => Promise<void>;
  compact?: boolean;
}

export function WorkerOverrideControls({ worker, onRefresh, compact }: WorkerOverrideControlsProps) {
  const effectiveCapacity = worker.maxConcurrentOverride ?? worker.capacity;
  const [inputValue, setInputValue] = useState(String(effectiveCapacity));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSet = async () => {
    const parsed = parseInt(inputValue, 10);
    if (isNaN(parsed) || parsed < 1 || parsed > 20) {
      setError('Must be 1-20');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateWorkerOverride(worker.workerId, parsed);
      await onRefresh?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateWorkerOverride(worker.workerId, null);
      setInputValue(String(worker.capacity));
      await onRefresh?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  };

  const exceedsHardware = worker.maxConcurrentOverride != null && worker.maxConcurrentOverride > worker.capacity;

  return (
    <div className={`flex items-center gap-2 flex-wrap ${compact ? '' : 'mt-1.5'}`}>
      {!compact && <span className="text-gray-500">capacity:</span>}
      <span className="text-gray-300">
        {worker.activeSimulations}/{effectiveCapacity}
      </span>
      {worker.maxConcurrentOverride != null && (
        <span className="text-gray-500">(hw: {worker.capacity})</span>
      )}
      {exceedsHardware && (
        <span className="text-amber-400">exceeds hardware</span>
      )}
      <input
        type="number"
        min={1}
        max={20}
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        className="w-14 px-1.5 py-0.5 bg-gray-700 border border-gray-600 rounded text-gray-200 text-xs text-center"
        disabled={saving}
      />
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); handleSet(); }}
        disabled={saving}
        className="px-2 py-0.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-xs text-white"
      >
        Set
      </button>
      {worker.maxConcurrentOverride != null && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); handleClear(); }}
          disabled={saving}
          className="px-2 py-0.5 bg-gray-600 hover:bg-gray-500 disabled:opacity-50 rounded text-xs text-gray-200"
        >
          Clear
        </button>
      )}
      {error && <span className="text-red-400 text-xs">{error}</span>}
    </div>
  );
}
