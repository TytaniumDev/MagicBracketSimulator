/**
 * Parser for the `X-Max-Concurrent-Override` header returned by the API's
 * `/api/jobs/claim-sim` endpoint. Counterpart to api/lib/override-header.ts.
 *
 * Returns:
 *   undefined — header absent or malformed (leave current override alone)
 *   null      — explicit clear (revert to hardware capacity)
 *   number    — apply this override
 *
 * The upper bound is enforced by the write-side validators (PATCH
 * /api/workers/:id and worker /config endpoint), so this parser trusts
 * any positive integer from the API — same contract as applyOverride().
 */

export const OVERRIDE_HEADER_NONE = 'none';

export function parseOverrideHeader(header: string | null): number | null | undefined {
  if (header === null) return undefined;
  if (header === OVERRIDE_HEADER_NONE) return null;
  const n = parseInt(header, 10);
  if (Number.isInteger(n) && n >= 1 && String(n) === header) return n;
  return undefined;
}
