import { z } from 'zod';
import { SIMULATIONS_MIN, SIMULATIONS_MAX, PARALLELISM_MIN, PARALLELISM_MAX } from './types';
import { REQUIRED_DECK_COUNT } from '@shared/types/job';
import { MAX_POD_RUN_DECKS } from '@shared/types/pod-run';

// ---------------------------------------------------------------------------
// POST /api/jobs — Create job
// ---------------------------------------------------------------------------

export const createJobSchema = z.object({
  deckIds: z.array(z.string().min(1)).length(4, 'Exactly 4 deckIds are required'),
  simulations: z.number().int().min(SIMULATIONS_MIN).max(SIMULATIONS_MAX),
  parallelism: z.number().int().min(PARALLELISM_MIN).max(PARALLELISM_MAX).optional(),
  idempotencyKey: z.string().optional(),
});

export type CreateJobInput = z.infer<typeof createJobSchema>;

// ---------------------------------------------------------------------------
// PATCH /api/jobs/[id]/simulations/[simId] — Update simulation
// ---------------------------------------------------------------------------

const simulationStateEnum = z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED']);

export const updateSimulationSchema = z.object({
  state: simulationStateEnum.optional(),
  workerId: z.string().optional(),
  workerName: z.string().optional(),
  durationMs: z.number().optional(),
  errorMessage: z.string().optional(),
  winner: z.string().optional(),
  winningTurn: z.number().optional(),
  winners: z.array(z.string()).optional(),
  winningTurns: z.array(z.number()).optional(),
});

export type UpdateSimulationInput = z.infer<typeof updateSimulationSchema>;

// ---------------------------------------------------------------------------
// POST /api/pod-runs — Save a pod run
// ---------------------------------------------------------------------------

export const createPodRunSchema = z.object({
  deckIds: z
    .array(z.string().min(1))
    .min(REQUIRED_DECK_COUNT + 1, `At least ${REQUIRED_DECK_COUNT + 1} deckIds are required`)
    .max(MAX_POD_RUN_DECKS, `At most ${MAX_POD_RUN_DECKS} deckIds are allowed`),
  // C(MAX_POD_RUN_DECKS, 4) = 210 pods at most.
  jobIds: z.array(z.string().min(1)).min(1).max(210),
  simulations: z.number().int().min(SIMULATIONS_MIN).max(SIMULATIONS_MAX),
  idempotencyKey: z.string().optional(),
});

export type CreatePodRunInput = z.infer<typeof createPodRunSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse and validate a request body against a zod schema.
 * Returns { success: true, data } on valid input, { success: false, error } on invalid.
 */
export function parseBody<T>(schema: z.ZodSchema<T>, body: unknown):
  { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(body);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const messages = result.error.issues.map(
    (i) => (i.path.length > 0 ? `${i.path.join('.')}: ` : '') + i.message
  );
  return { success: false, error: messages.join('; ') || 'Invalid request body' };
}
