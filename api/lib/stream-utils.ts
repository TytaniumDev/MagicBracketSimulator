import { GAMES_PER_CONTAINER, type Job } from './types';

export interface QueueInfo {
  queuePosition?: number;
  workers?: { online: number; idle: number; busy: number; updating: number };
}

export function jobToStreamEvent(
  job: Job,
  queueInfo?: QueueInfo,
  deckLinks?: Record<string, string | null>,
  computedGamesCompleted?: number
) {
  const deckNames = job.decks.map((d) => d.name);
  const start = job.startedAt?.getTime() ?? job.createdAt.getTime();
  const end = job.completedAt?.getTime();
  const durationMs = end != null ? end - start : null;

  return {
    id: job.id,
    name: deckNames.join(' vs '),
    deckNames,
    status: job.status,
    simulations: job.simulations,
    gamesCompleted: computedGamesCompleted ?? (job.gamesCompleted ?? 0),
    parallelism: job.parallelism ?? 4,
    createdAt: job.createdAt.toISOString(),
    errorMessage: job.errorMessage,
    startedAt: job.startedAt?.toISOString(),
    completedAt: job.completedAt?.toISOString(),
    durationMs,
    dockerRunDurationsMs: job.dockerRunDurationsMs,
    workerId: job.workerId,
    workerName: job.workerName,
    claimedAt: job.claimedAt?.toISOString(),
    retryCount: job.retryCount ?? 0,
    ...(queueInfo?.queuePosition != null && { queuePosition: queueInfo.queuePosition }),
    ...(queueInfo?.workers && { workers: queueInfo.workers }),
    ...(deckLinks && { deckLinks }),
  };
}
