#!/usr/bin/env node
/**
 * Interactive script to populate Google Secret Manager with local-worker config.
 * Run from repo root: node scripts/populate-worker-secret.js
 *
 * Prereqs: GOOGLE_CLOUD_PROJECT set (env or .env); gcloud auth application-default login
 * (or GOOGLE_APPLICATION_CREDENTIALS pointing to a key with Secret Manager access).
 */

const path = require('path');
const readline = require('readline');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', 'local-worker', '.env') });

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT;
const SECRET_NAME = 'local-worker-config';

const CONSOLE_BASE = 'https://console.cloud.google.com';
const RUN_URL = `${CONSOLE_BASE}/run?project=`;
const STORAGE_URL = `${CONSOLE_BASE}/storage/browser?project=`;
const PUBSUB_URL = `${CONSOLE_BASE}/cloudpubsub/subscription/list?project=`;
const SECRETS_URL = `${CONSOLE_BASE}/security/secret-manager?project=`;
const ADC_DOCS = 'https://cloud.google.com/docs/authentication/application-default-credentials';

function link(url, label) {
  return label ? `${label}: ${url}` : url;
}

function prompt(rl, message, helpUrl, defaultValue) {
  const defaultStr = defaultValue !== undefined && defaultValue !== '' ? ` [${defaultValue}]` : '';
  return new Promise((resolve) => {
    if (helpUrl) {
      const pid = PROJECT_ID || 'YOUR_PROJECT_ID';
      const href = helpUrl.startsWith('http') ? helpUrl : CONSOLE_BASE + helpUrl + pid;
      console.log('\n  → ' + link(href, 'Open in browser'));
    }
    rl.question(`\n${message}${defaultStr}: `, (answer) => {
      const trimmed = (answer || '').trim();
      resolve(trimmed !== '' ? trimmed : (defaultValue ?? ''));
    });
  });
}

async function checkPrereqs() {
  if (!PROJECT_ID) {
    console.error(`
ERROR: GOOGLE_CLOUD_PROJECT is not set.

Set it in your environment or in a .env file (repo root or local-worker/).
Example: GOOGLE_CLOUD_PROJECT=magic-bracket-simulator

For Application Default Credentials (so you don't need a key file on this machine):
  ${link(ADC_DOCS, 'Set up ADC')}
`);
    process.exit(1);
  }
  console.log(`Using project: ${PROJECT_ID}`);
  console.log('(If Secret Manager calls fail, run: gcloud auth application-default login)');
}

async function main() {
  console.log(`
This script will create or update the Secret Manager secret "${SECRET_NAME}"
so the local-worker can run without a .env file on each machine.

You need:
  • GOOGLE_CLOUD_PROJECT set (env or .env)
  • gcloud auth application-default login (or a service account key with Secret Manager access)
`);

  await checkPrereqs();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const runUrl = RUN_URL + PROJECT_ID;
  const storageUrl = STORAGE_URL + PROJECT_ID;
  const pubsubUrl = PUBSUB_URL + PROJECT_ID;
  const secretsUrl = SECRETS_URL + PROJECT_ID;

  console.log('\n--- Values to store (press Enter to accept default) ---');

  const API_URL = await prompt(
    rl,
    'API_URL – Cloud Run URL of your orchestrator service (e.g. https://orchestrator-xxxxx-uc.a.run.app)',
    runUrl,
    'https://orchestrator-jfmj7qwxca-uc.a.run.app'
  );

  const GCS_BUCKET = await prompt(
    rl,
    'GCS_BUCKET – Bucket name for job artifacts',
    storageUrl,
    `${PROJECT_ID}-artifacts`
  );

  const PUBSUB_SUBSCRIPTION = await prompt(
    rl,
    'PUBSUB_SUBSCRIPTION – Subscription the worker pulls from (e.g. job-created-worker)',
    pubsubUrl,
    'job-created-worker'
  );

  console.log(`
  WORKER_SECRET – Shared secret between worker and orchestrator API.
  If you don't have one: generate with: openssl rand -hex 32
  Set the same value in your Cloud Run orchestrator env (WORKER_SECRET).
`);
  const WORKER_SECRET = await prompt(
    rl,
    'WORKER_SECRET',
    secretsUrl,
    ''
  );

  const FORGE_SIM_IMAGE = await prompt(
    rl,
    'FORGE_SIM_IMAGE – Docker image name for forge-sim',
    null,
    'forge-sim:latest'
  );

  const MISC_RUNNER_IMAGE = await prompt(
    rl,
    'MISC_RUNNER_IMAGE – Docker image name for misc-runner',
    null,
    'misc-runner:latest'
  );

  const JOBS_DIR = await prompt(
    rl,
    'JOBS_DIR – Local path for job files on this machine',
    null,
    './jobs'
  );

  rl.close();

  const config = {
    API_URL,
    GCS_BUCKET,
    PUBSUB_SUBSCRIPTION,
    WORKER_SECRET,
    FORGE_SIM_IMAGE,
    MISC_RUNNER_IMAGE,
    JOBS_DIR,
  };
  // Omit empty optional
  if (!config.WORKER_SECRET) delete config.WORKER_SECRET;

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
          secret: {
            replication: { automatic: {} },
          },
        });
        console.log(`Created secret: ${SECRET_NAME}`);
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

On any machine: set GOOGLE_CLOUD_PROJECT and use gcloud auth application-default login
(or a service account key with Secret Manager Secret Accessor). No .env needed; run:
  npm run worker:gcp
`);
  } catch (err) {
    const msg = err.message || String(err);
    console.error('Failed to write secret:', msg);
    if (msg.includes('Could not load the default credentials') || msg.includes('Permission') || msg.includes('403')) {
      console.error(`\nRun: gcloud auth application-default login\n  ${ADC_DOCS}`);
    }
    process.exit(1);
  }
}

main();
