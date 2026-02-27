import { z } from 'zod';
import { SIMULATIONS_MIN, SIMULATIONS_MAX, PARALLELISM_MIN, PARALLELISM_MAX } from './types';

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
// PATCH /api/jobs/[id] — Update job
// ---------------------------------------------------------------------------

const jobStatusEnum = z.enum(['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED']);

export const updateJobSchema = z.object({
  status: jobStatusEnum.optional(),
  errorMessage: z.string().optional(),
  dockerRunDurationsMs: z.array(z.number()).optional(),
  workerId: z.string().optional(),
  workerName: z.string().optional(),
});

export type UpdateJobInput = z.infer<typeof updateJobSchema>;

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
  const messages = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).filter(Boolean);
  return { success: false, error: messages.join('; ') || 'Invalid request body' };
}
