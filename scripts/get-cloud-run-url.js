#!/usr/bin/env node
/**
 * Print your Cloud Run service URL(s) so you can set API_URL / VITE_API_URL.
 * Uses gcloud (no Firebase Console login). Run from repo root.
 *
 * Prereq: gcloud installed and authenticated (gcloud auth login).
 * Set GOOGLE_CLOUD_PROJECT or pass --project=PROJECT_ID.
 *
 * Usage:
 *   node scripts/get-cloud-run-url.js
 *   node scripts/get-cloud-run-url.js --project=magic-bracket-simulator
 *   GOOGLE_CLOUD_PROJECT=magic-bracket-simulator node scripts/get-cloud-run-url.js
 */

const path = require('path');
const { execSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', 'worker', '.env') });

/** Get GCP project from gcloud config when GOOGLE_CLOUD_PROJECT is not set (no .env needed). */
function getProjectFromGcloud() {
  try {
    const out = execSync('gcloud config get-value project --format="value(core.project)"', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const p = (out || '').trim();
    return p.length > 0 ? p : null;
  } catch {
    return null;
  }
}

const projectArg = process.argv.find((a) => a.startsWith('--project='));
const projectId =
  projectArg?.split('=')[1] || process.env.GOOGLE_CLOUD_PROJECT || getProjectFromGcloud();

if (!projectId) {
  console.error(`
Usage: node scripts/get-cloud-run-url.js [--project=PROJECT_ID]
   or: GOOGLE_CLOUD_PROJECT=your-project node scripts/get-cloud-run-url.js
   or: gcloud config set project YOUR_PROJECT_ID  (then run without .env)

Set GOOGLE_CLOUD_PROJECT, pass --project=, or set gcloud default project.
`);
  process.exit(1);
}

const base = ['gcloud', 'run', 'services', 'list', '--platform', 'managed', '--project', projectId];

try {
  // List services and get URL (region required for describe)
  const listRaw = execSync([...base, '--format=json'].join(' '), {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const list = JSON.parse(listRaw);

  if (!list.length) {
    console.log('No Cloud Run services found in project:', projectId);
    console.log('\nIf you use Firebase App Hosting, deploy the backend first.');
    console.log('  Firebase Console: Build → App Hosting → your backend → URL');
    console.log('  GCP Console: https://console.cloud.google.com/run?project=' + projectId);
    process.exit(0);
    return;
  }

  console.log('Cloud Run services and URLs in project:', projectId);
  console.log('');

  for (const svc of list) {
    const name = svc.metadata?.name || svc.name || '?';
    const region = svc.metadata?.labels?.['cloud.googleapis.com/location'] || svc.metadata?.annotations?.['run.googleapis.com/location'] || '?';
    const url = svc.status?.url || '';
    if (url) {
      console.log(`  ${name} (${region})`);
      console.log(`    ${url}`);
      console.log('');
    } else {
      // Fallback: describe to get URL
      try {
        const regionFromSelfLink = (svc.metadata?.selfLink || '').split('/locations/')[1]?.split('/')[0] || 'us-central1';
        const desc = execSync(
          `gcloud run services describe ${name} --platform managed --region ${regionFromSelfLink} --project ${projectId} --format="value(status.url)"`,
          { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
        );
        const u = (desc || '').trim();
        if (u) {
          console.log(`  ${name} (${regionFromSelfLink})`);
          console.log(`    ${u}`);
          console.log('');
        }
      } catch (_) {
        console.log(`  ${name} – (could not get URL)`);
        console.log('');
      }
    }
  }

  console.log('Use one of the URLs above as API_URL / VITE_API_URL (orchestrator backend).');
  console.log('Firebase Console (App Hosting): https://console.firebase.google.com/project/' + projectId + '/apphosting');
  console.log('GCP Cloud Run: https://console.cloud.google.com/run?project=' + projectId);
} catch (err) {
  if (err.stderr && (err.stderr.includes('NOT_FOUND') || err.stderr.includes('Permission'))) {
    console.error('Ensure gcloud is logged in and has access to the project:');
    console.error('  gcloud auth login');
    console.error('  gcloud config set project', projectId);
  } else {
    console.error(err.message || err);
  }
  process.exit(1);
}
