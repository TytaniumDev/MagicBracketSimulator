import { Precon } from './types';
import * as fs from 'fs';
import * as path from 'path';

let cachedPrecons: Precon[] | null = null;

export function loadPrecons(): Precon[] {
  if (cachedPrecons) {
    return cachedPrecons;
  }

  const forgeEnginePath = process.env.FORGE_ENGINE_PATH || '../forge-simulation-engine';
  const manifestPath = path.resolve(forgeEnginePath, 'precons', 'manifest.json');

  try {
    const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
    const manifest = JSON.parse(manifestContent);
    cachedPrecons = manifest.precons as Precon[];
    return cachedPrecons;
  } catch (error) {
    console.error('Failed to load precons manifest:', error);
    // Return empty array if manifest can't be loaded
    return [];
  }
}

export function getPreconByName(name: string): Precon | undefined {
  const precons = loadPrecons();
  return precons.find(p => p.name === name);
}

export function getPreconById(id: string): Precon | undefined {
  const precons = loadPrecons();
  return precons.find(p => p.id === id);
}

export function pickRandomPrecons(count: number): Precon[] {
  const precons = loadPrecons();
  if (precons.length < count) {
    throw new Error(`Not enough precons available. Need ${count}, have ${precons.length}`);
  }

  const shuffled = [...precons].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

export function validatePreconIds(ids: string[]): { valid: boolean; invalid: string[] } {
  const precons = loadPrecons();
  const preconIds = new Set(precons.map(p => p.id));
  const invalid = ids.filter(id => !preconIds.has(id));
  return { valid: invalid.length === 0, invalid };
}
