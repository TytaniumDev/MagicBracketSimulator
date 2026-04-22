/**
 * Wire format for the `X-Max-Concurrent-Override` header returned by
 * `GET /api/jobs/claim-sim` and consumed by the worker's polling loop.
 *
 * A positive integer is emitted verbatim; a null/unset override is encoded
 * as the literal string `'none'`. The worker's parseOverrideHeader
 * (worker/src/override.ts) is the counterpart — keep the two in sync.
 */

export const OVERRIDE_HEADER_NAME = 'X-Max-Concurrent-Override';
export const OVERRIDE_HEADER_NONE = 'none';

export function encodeOverrideHeader(override: number | null): string {
  return override == null ? OVERRIDE_HEADER_NONE : String(override);
}
