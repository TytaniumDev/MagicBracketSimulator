/**
 * Point a script at production using the service account kept in Doppler,
 * so it runs without `gcloud auth application-default login`. Needs the
 * Doppler CLI signed in (`doppler login`).
 *
 * Call before importing any lib module: they read GOOGLE_CLOUD_PROJECT
 * when they load.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const DOPPLER_PROJECT = 'magic-bracket-simulator';
const DOPPLER_CONFIG = 'dev';

/**
 * Write Doppler's GCP_SA_KEY to a private temp file (deleted on exit) and
 * set GOOGLE_APPLICATION_CREDENTIALS, GOOGLE_CLOUD_PROJECT and GCS_BUCKET
 * from it. Values already set in the environment win.
 */
export function useDopplerCredentials(): void {
  const secrets = JSON.parse(
    execFileSync(
      'doppler',
      ['secrets', 'download', '--no-file', '--format', 'json', '--project', DOPPLER_PROJECT, '--config', DOPPLER_CONFIG],
      { encoding: 'utf8' },
    ),
  ) as Record<string, string>;

  const key = secrets.GCP_SA_KEY;
  if (!key) throw new Error(`GCP_SA_KEY is missing from Doppler ${DOPPLER_PROJECT}/${DOPPLER_CONFIG}`);

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mbs-sa-'));
    const file = path.join(dir, 'key.json');
    fs.writeFileSync(file, key, { mode: 0o600 });
    process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
    process.env.GOOGLE_APPLICATION_CREDENTIALS = file;
  }
  process.env.GOOGLE_CLOUD_PROJECT ??= (JSON.parse(key) as { project_id: string }).project_id;
  if (secrets.GCS_BUCKET) process.env.GCS_BUCKET ??= secrets.GCS_BUCKET;
}
