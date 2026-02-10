import { memo } from 'react';
import { CondensedGame, LogViewTab } from '../types';
import { getEventColor } from '../utils/log-colors';

interface GameLogsProps {
  rawLogs: string[] | null;
  rawLogsError: string | null;
  condensedLogs: CondensedGame[] | null;
  condensedError: string | null;
  logViewTab: LogViewTab;
  onTabChange: (tab: LogViewTab) => void;
}

export const GameLogs = memo(function GameLogs({
  rawLogs,
  rawLogsError,
  condensedLogs,
  condensedError,
  logViewTab,
  onTabChange,
}: GameLogsProps) {
  return (
    <div className="mt-4">
      {/* Tab buttons */}
      <div className="flex gap-2 mb-4">
        <button
          type="button"
          onClick={() => onTabChange('condensed')}
          className={`px-3 py-1 rounded text-sm ${
            logViewTab === 'condensed'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          Condensed (AI Input)
        </button>
        <button
          type="button"
          onClick={() => onTabChange('raw')}
          className={`px-3 py-1 rounded text-sm ${
            logViewTab === 'raw'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
          }`}
        >
          Raw Logs
        </button>
      </div>

      {/* Condensed Logs View */}
      {logViewTab === 'condensed' && (
        <div>
          {condensedError && (
            <p className="text-sm text-red-400 mb-2">{condensedError}</p>
          )}
          {condensedLogs && condensedLogs.length === 0 && !condensedError && (
            <p className="text-sm text-gray-500">
              Condensed logs not available.
            </p>
          )}
          {condensedLogs && condensedLogs.length > 0 && (
            <div className="space-y-4">
              <p className="text-xs text-gray-400">
                This is the condensed data sent to the AI for bracket analysis.
              </p>
              {condensedLogs.map((game, i) => (
                <div key={i} className="bg-gray-900 rounded p-3">
                  <h4 className="text-xs font-semibold text-gray-500 mb-2">
                    Game {i + 1}
                    {game.winner && ` - Winner: ${game.winner}`}
                    {game.winningTurn && ` (Turn ${game.winningTurn})`}
                  </h4>
                  <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
                    <div className="bg-gray-800 rounded p-2">
                      <span className="text-gray-400">Turn Count: </span>
                      <span className="text-white">{game.turnCount}</span>
                    </div>
                    <div className="bg-gray-800 rounded p-2">
                      <span className="text-gray-400">Events Kept: </span>
                      <span className="text-white">{game.keptEvents.length}</span>
                    </div>
                  </div>
                  <div className="space-y-1 max-h-64 overflow-y-auto">
                    {game.keptEvents.map((event, j) => (
                      <div
                        key={j}
                        className="text-xs font-mono py-0.5 border-l-2 pl-2"
                        style={{ borderColor: getEventColor(event.type) }}
                      >
                        <span className="text-gray-500">[{event.type}]</span>{' '}
                        <span className="text-gray-300">{event.line}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Raw Logs View */}
      {logViewTab === 'raw' && (
        <div>
          {rawLogsError && (
            <p className="text-sm text-red-400 mb-2">{rawLogsError}</p>
          )}
          {rawLogs != null && rawLogs.length === 0 && !rawLogsError && (
            <p className="text-sm text-gray-500">
              Logs not available (job may still be running or logs were cleaned up).
            </p>
          )}
          {rawLogs != null && rawLogs.length > 0 && (
            <div className="space-y-4">
              {rawLogs.map((log, i) => (
                <div key={i} className="bg-gray-900 rounded p-3">
                  <h4 className="text-xs font-semibold text-gray-500 mb-2">Game {i + 1}</h4>
                  <pre className="text-xs overflow-auto max-h-64 whitespace-pre-wrap text-gray-400 font-mono">
                    {log}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});
