import { isGcpMode } from './job-store-factory';

const MAX_ACTIVE_JOBS = 3;
const MAX_JOBS_PER_DAY = 20;
const MAX_SIMULATIONS_PER_DAY = 500;

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

    // Check active jobs (QUEUED + RUNNING). Limit caps the query at one
    // over the threshold so a pathologically high-volume user can't cause
    // the query to load thousands of docs into memory.
    const activeSnap = await jobsRef
      .where('createdBy', '==', userId)
      .where('status', 'in', ['QUEUED', 'RUNNING'])
      .limit(MAX_ACTIVE_JOBS + 1)
      .get();

    if (activeSnap.size >= MAX_ACTIVE_JOBS) {
      return {
        allowed: false,
        reason: `You have ${activeSnap.size} active jobs. Maximum ${MAX_ACTIVE_JOBS} concurrent jobs allowed. Wait for current jobs to finish.`,
      };
    }

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
