export const RATING_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;
import { SCALE } from './glicko2';

export function applyDecay(rd: number, vol: number, lastUpdated: string | Date, now: string | Date): number {
  const last = new Date(lastUpdated).getTime();
  const current = new Date(now).getTime();
  if (current <= last) return rd;

  const periods = Math.floor((current - last) / RATING_PERIOD_MS);
  if (periods <= 0) return rd;

  let phi = rd / SCALE;
  for (let i = 0; i < periods; i++) {
    phi = Math.sqrt(phi * phi + vol * vol);
  }
  
  // Cap RD at DEFAULT_RD
  return Math.min(phi * SCALE, 350);
}
