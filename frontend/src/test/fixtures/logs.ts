import type { JobLogsData } from '../../hooks/useJobLogs';
import { DEFAULT_DECK_NAMES } from './factory';

/**
 * Default empty logs — the state before any log data is loaded.
 */
export const emptyLogs: JobLogsData = {
  rawLogs: null,
  rawLogsError: null,
  rawLogsLoading: false,
  condensedLogs: null,
  condensedError: null,
  condensedLoading: false,
  structuredGames: null,
  structuredError: null,
  structuredLoading: false,
  deckNames: null,
  colorIdentityByDeckName: {},
};

/**
 * Logs with color identity data resolved (server-provided).
 */
export const logsWithColorIdentity: JobLogsData = {
  ...emptyLogs,
  colorIdentityByDeckName: {
    [DEFAULT_DECK_NAMES[0]]: ['W', 'U', 'B', 'G'],
    [DEFAULT_DECK_NAMES[1]]: ['B', 'R', 'G'],
    [DEFAULT_DECK_NAMES[2]]: ['U', 'B'],
    [DEFAULT_DECK_NAMES[3]]: ['W', 'U', 'B', 'R'],
  },
};
