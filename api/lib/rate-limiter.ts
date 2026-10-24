import { isGcpMode } from './env';

// No cap on active (QUEUED + RUNNING) jobs: pod runs queue one job per
// 4-deck combination and let them wait their turn. The stale-sweeper clears
// anything left QUEUED for more than 3 days.
const MAX_JOBS_PER_DAY = 250;
const MAX_SIMULATIONS_PER_DAY = 25_000;

interface RateLimitResult {
  allowed: boolean;
  reason?: string;
}

export async function checkRateLimit(
  userId: string,
  requestedSimulations: number
): Promise<RateLimitResult> {
  if (!isGcpMode()) {
    return { allowed: true };
  }

  try {
    const { getFirestore } = await import('./firestore-client');
    const jobsRef = getFirestore().collection('jobs');

    // Check daily limits. Limit caps at (MAX_JOBS_PER_DAY + 1) — if there
    // are more than MAX_JOBS_PER_DAY we reject immediately, so we never
    // need to sum simulations from more than MAX_JOBS_PER_DAY docs.
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const dailySnap = await jobsRef
      .where('createdBy', '==', userId)
      .where('createdAt', '>=', startOfDay)
      .limit(MAX_JOBS_PER_DAY + 1)
      .get();

    if (dailySnap.size >= MAX_JOBS_PER_DAY) {
      return {
        allowed: false,
        reason: `Daily limit reached: ${dailySnap.size}/${MAX_JOBS_PER_DAY} jobs today. Try again tomorrow.`,
      };
    }

    // Check daily simulation count
    let dailySimulations = 0;
    dailySnap.forEach((doc) => {
      dailySimulations += doc.data().simulations ?? 0;
    });

    if (dailySimulations + requestedSimulations > MAX_SIMULATIONS_PER_DAY) {
      return {
        allowed: false,
        reason: `Daily simulation limit: ${dailySimulations}/${MAX_SIMULATIONS_PER_DAY} simulations used today. Requesting ${requestedSimulations} more would exceed the limit.`,
      };
    }

    return { allowed: true };
  } catch (error) {
    console.error('Rate limit check failed:', error);
    // Fail open — don't block users if the rate limiter has a bug
    return { allowed: true };
  }
}
