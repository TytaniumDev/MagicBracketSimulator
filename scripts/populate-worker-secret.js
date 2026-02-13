#!/usr/bin/env node
/**
 * Populate Google Secret Manager with worker config.
 * Run from repo root: node scripts/populate-worker-secret.js
 *
 * Usage:
 *   npm run populate-worker-secret                              # interactive
 *   npm run populate-worker-secret -- --defaults                # accept all defaults (WORKER_SECRET optional)
 *   npm run populate-worker-secret -- --defaults --worker-secret=abc123
 *   npm run populate-worker-secret -- --defaults --api-url=https://custom-url.com
 *
 * Prereqs: GOOGLE_CLOUD_PROJECT set (env or .env); gcloud auth application-default login
 * (or GOOGLE_APPLICATION_CREDENTIALS pointing to a key with Secret Manager access).
 */

const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', 'worker', '.env') });

// Parse CLI flags
const args = process.argv.slice(2);
const USE_DEFAULTS = args.includes('--defaults');
function getArgValue(name) {
  const prefix = `--${name}=`;
  const arg = args.find(a => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

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
const SECRET_NAME = 'simulation-worker-config';

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
      console.log('\n  \u2192 ' + link(href, 'Open in browser'));
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
ERROR: GCP project is not set.

Either:
  \u2022 gcloud config set project YOUR_PROJECT_ID   (no .env needed)
  \u2022 GOOGLE_CLOUD_PROJECT=your-project npm run populate-worker-secret
  \u2022 Or set GOOGLE_CLOUD_PROJECT in your environment or .env

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
so the worker can run without a .env file on each machine.

You need:
  \u2022 GOOGLE_CLOUD_PROJECT set (env or .env)
  \u2022 gcloud auth application-default login (or a service account key with Secret Manager access)
`);

  await checkPrereqs();

  // Default values
  const defaults = {
    API_URL: 'https://api--magic-bracket-simulator.us-central1.hosted.app',
    GCS_BUCKET: `${PROJECT_ID}-artifacts`,
    PUBSUB_SUBSCRIPTION: 'job-created-worker',
    PUBSUB_WORKER_REPORT_IN_SUBSCRIPTION: 'worker-report-in-worker',
    WORKER_SECRET: '',
  };

  let API_URL, GCS_BUCKET, PUBSUB_SUBSCRIPTION, PUBSUB_WORKER_REPORT_IN_SUBSCRIPTION, WORKER_SECRET;

  if (USE_DEFAULTS) {
    // Non-interactive mode: use defaults with CLI overrides
    API_URL = getArgValue('api-url') || defaults.API_URL;
    GCS_BUCKET = getArgValue('gcs-bucket') || defaults.GCS_BUCKET;
    PUBSUB_SUBSCRIPTION = getArgValue('pubsub-subscription') || defaults.PUBSUB_SUBSCRIPTION;
    PUBSUB_WORKER_REPORT_IN_SUBSCRIPTION = defaults.PUBSUB_WORKER_REPORT_IN_SUBSCRIPTION;
    WORKER_SECRET = getArgValue('worker-secret') || defaults.WORKER_SECRET;

    console.log('\n--- Using defaults (--defaults mode) ---');
    console.log(`  API_URL: ${API_URL}`);
    console.log(`  GCS_BUCKET: ${GCS_BUCKET}`);
    console.log(`  PUBSUB_SUBSCRIPTION: ${PUBSUB_SUBSCRIPTION}`);
    console.log(`  PUBSUB_WORKER_REPORT_IN_SUBSCRIPTION: ${PUBSUB_WORKER_REPORT_IN_SUBSCRIPTION}`);
    console.log(`  WORKER_SECRET: ${WORKER_SECRET ? '(set)' : '(not set)'}`);
  } else {
    // Interactive mode
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    const runUrl = RUN_URL + PROJECT_ID;
    const storageUrl = STORAGE_URL + PROJECT_ID;
    const pubsubUrl = PUBSUB_URL + PROJECT_ID;
    const secretsUrl = SECRETS_URL + PROJECT_ID;

    console.log('\n--- Values to store (press Enter to accept default) ---');

    API_URL = await prompt(
      rl,
      'API_URL \u2013 API URL (App Hosting: https://api--magic-bracket-simulator.us-central1.hosted.app)',
      runUrl,
      defaults.API_URL
    );

    GCS_BUCKET = await prompt(
      rl,
      'GCS_BUCKET \u2013 Bucket name for job artifacts',
      storageUrl,
      defaults.GCS_BUCKET
    );

    PUBSUB_SUBSCRIPTION = await prompt(
      rl,
      'PUBSUB_SUBSCRIPTION \u2013 Subscription the worker pulls from',
      pubsubUrl,
      defaults.PUBSUB_SUBSCRIPTION
    );

    PUBSUB_WORKER_REPORT_IN_SUBSCRIPTION = await prompt(
      rl,
      'PUBSUB_WORKER_REPORT_IN_SUBSCRIPTION \u2013 Subscription for frontend-triggered worker status',
      pubsubUrl,
      defaults.PUBSUB_WORKER_REPORT_IN_SUBSCRIPTION
    );

    console.log(`
  WORKER_SECRET \u2013 Shared secret between worker and API.
  If you don't have one: generate with: openssl rand -hex 32
  Set the same value in your Cloud Run API env (WORKER_SECRET).
`);
    WORKER_SECRET = await prompt(
      rl,
      'WORKER_SECRET',
      secretsUrl,
      defaults.WORKER_SECRET
    );

    rl.close();
  }

  const config = {
    API_URL,
    GCS_BUCKET,
    PUBSUB_SUBSCRIPTION,
    PUBSUB_WORKER_REPORT_IN_SUBSCRIPTION,
    WORKER_SECRET,
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
(or a service account key with Secret Manager Secret Accessor). No .env needed.
Start the worker with: docker compose -f worker/docker-compose.yml up
`);
  } catch (err) {
    const msg = err.message || String(err);
    console.error('Failed to write secret:', msg);
    if (msg.includes('Could not load the default credentials') || msg.includes('Permission') || msg.includes('403') || msg.includes('PERMISSION_DENIED')) {
      console.error('\nIf GOOGLE_APPLICATION_CREDENTIALS is set (e.g. in .env), that service account needs Secret Manager access.');
      console.error('Either: grant that service account "Secret Manager Admin" in IAM, or run without it:');
      console.error('  GOOGLE_APPLICATION_CREDENTIALS= npm run populate-worker-secret');
      console.error(`(Then run: gcloud auth application-default login if needed.\n  ${ADC_DOCS})`);
    }
    process.exit(1);
  }
}

main();
