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
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', 'frontend', '.env') });

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT;
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
ERROR: GOOGLE_CLOUD_PROJECT is not set.

Set it in your environment or in a .env file (repo root or frontend/).
Example: GOOGLE_CLOUD_PROJECT=magic-bracket-simulator
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
    'apiUrl – Cloud Run URL of your orchestrator (e.g. https://orchestrator-xxxxx-uc.a.run.app)',
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
    if (msg.includes('Could not load the default credentials') || msg.includes('Permission') || msg.includes('403')) {
      console.error('\nRun: gcloud auth application-default login');
    }
    process.exit(1);
  }
}

main();
