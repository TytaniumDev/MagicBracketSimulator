#!/usr/bin/env node
/**
 * One-time: create/update the frontend-config secret in Google Secret Manager.
 * Store apiUrl (and optional logAnalyzerUrl) so you don't need .env on your machine.
 *
 * Prereqs: GOOGLE_CLOUD_PROJECT set; gcloud auth application-default login
 *   (or a key with Secret Manager Secret Accessor / Admin).
 *
 * Usage: node scripts/populate-frontend-secret.js
 *        GOOGLE_CLOUD_PROJECT=magic-bracket-simulator node scripts/populate-frontend-secret.js
 *
 * Then on any machine: node scripts/fetch-frontend-config.js (with ADC) then build/deploy.
 */

const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', 'frontend', '.env') });
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

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || getProjectFromGcloud();
const SECRET_NAME = 'frontend-config';

const CONSOLE_BASE = 'https://console.cloud.google.com';
const RUN_URL = `${CONSOLE_BASE}/run?project=`;
const APP_HOSTING_URL = 'https://console.firebase.google.com/project/';

function prompt(rl, message, helpUrl, defaultValue) {
  const defaultStr = defaultValue !== undefined && defaultValue !== '' ? ` [${defaultValue}]` : '';
  return new Promise((resolve) => {
    if (helpUrl) {
      const href = helpUrl.startsWith('http') ? helpUrl : CONSOLE_BASE + helpUrl + (PROJECT_ID || 'YOUR_PROJECT_ID');
      console.log('\n  → Open in browser: ' + href);
    }
    rl.question('\n' + message + defaultStr + ': ', (answer) => {
      const trimmed = (answer || '').trim();
      resolve(trimmed !== '' ? trimmed : (defaultValue ?? ''));
    });
  });
}

async function main() {
  if (!PROJECT_ID) {
    console.error(`
ERROR: GCP project is not set.

Either:
  • gcloud config set project YOUR_PROJECT_ID   (no .env needed)
  • GOOGLE_CLOUD_PROJECT=your-project npm run populate-frontend-secret
  • Or set GOOGLE_CLOUD_PROJECT in your environment or .env
`);
    process.exit(1);
  }

  console.log(`
This script creates/updates the Secret Manager secret "${SECRET_NAME}"
so the frontend can use the API URL without storing it in .env.

After this, run: node scripts/fetch-frontend-config.js
before building or deploying the frontend (or run that in CI).
`);
  console.log('Using project:', PROJECT_ID);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const apiUrl = await prompt(
    rl,
    'apiUrl – API URL (default: stable App Hosting URL in committed config.json)',
    null,
    ''
  );
  const logAnalyzerUrl = await prompt(
    rl,
    'logAnalyzerUrl – optional; leave blank for default (localhost:3001 or same as API in prod)',
    null,
    ''
  );

  rl.close();

  const config = { apiUrl: apiUrl || undefined, logAnalyzerUrl: logAnalyzerUrl || undefined };
  if (!config.apiUrl) {
    console.error('apiUrl is required.');
    process.exit(1);
  }
  if (!config.logAnalyzerUrl) delete config.logAnalyzerUrl;

  const client = new SecretManagerServiceClient();
  const parent = `projects/${PROJECT_ID}`;
  const payload = Buffer.from(JSON.stringify(config, null, 2), 'utf8');

  try {
    try {
      await client.getSecret({ name: `${parent}/secrets/${SECRET_NAME}` });
    } catch (e) {
      if (e.code === 5 || (e.message && e.message.includes('NOT_FOUND'))) {
        await client.createSecret({
          parent,
          secretId: SECRET_NAME,
          secret: { replication: { automatic: {} } },
        });
        console.log('Created secret:', SECRET_NAME);
      } else {
        throw e;
      }
    }
    const [version] = await client.addSecretVersion({
      parent: `${parent}/secrets/${SECRET_NAME}`,
      payload: { data: payload },
    });
    console.log(`
Done. Secret "${SECRET_NAME}" updated (version: ${version.name?.split('/').pop() ?? 'latest'}).

Before building or deploying the frontend, run:
  node scripts/fetch-frontend-config.js
Then: npm run build --prefix frontend   (or firebase deploy)
`);
  } catch (err) {
    const msg = err.message || String(err);
    console.error('Failed to write secret:', msg);
    if (msg.includes('Could not load the default credentials') || msg.includes('Permission') || msg.includes('403') || msg.includes('PERMISSION_DENIED')) {
      console.error('\nIf GOOGLE_APPLICATION_CREDENTIALS is set (e.g. in .env), that service account needs Secret Manager access.');
      console.error('Either: grant that service account "Secret Manager Admin" in IAM, or run without it:');
      console.error('  GOOGLE_APPLICATION_CREDENTIALS= npm run populate-frontend-secret');
      console.error('(Then run: gcloud auth application-default login if needed.)');
    }
    process.exit(1);
  }
}

main();
