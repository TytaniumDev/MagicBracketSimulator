#!/usr/bin/env node
/**
 * Fetch frontend config from Google Secret Manager and write frontend/public/config.json.
 * Use this so you don't store VITE_API_URL (or other frontend env) in .env on your machine.
 *
 * Prereqs: GOOGLE_CLOUD_PROJECT set; gcloud auth application-default login
 *   (or GOOGLE_APPLICATION_CREDENTIALS with Secret Manager access).
 *
 * Usage:
 *   node scripts/fetch-frontend-config.js
 *   GOOGLE_CLOUD_PROJECT=magic-bracket-simulator node scripts/fetch-frontend-config.js
 *
 * Then build: npm run build --prefix frontend
 * Or deploy: firebase deploy (predeploy will build; ensure config.json exists or is generated in CI).
 */

const path = require('path');
const fs = require('fs');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
require('dotenv').config({ path: path.join(__dirname, '..', 'frontend', '.env') });

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT;
const SECRET_NAME = 'frontend-config';
const OUT_PATH = path.join(__dirname, '..', 'frontend', 'public', 'config.json');

async function main() {
  if (!PROJECT_ID) {
    console.error(`
ERROR: GOOGLE_CLOUD_PROJECT is not set.

Set it in your environment or in a .env file (repo root or frontend/).
Example: GOOGLE_CLOUD_PROJECT=magic-bracket-simulator

Then run: node scripts/fetch-frontend-config.js
`);
    process.exit(1);
  }

  try {
    const client = new SecretManagerServiceClient();
    const [version] = await client.accessSecretVersion({
      name: `projects/${PROJECT_ID}/secrets/${SECRET_NAME}/versions/latest`,
    });
    const payload = version.payload?.data;
    if (!payload) {
      console.error('Secret has no payload.');
      process.exit(1);
    }
    const raw = typeof payload === 'string' ? payload : Buffer.from(payload).toString('utf8');
    const config = JSON.parse(raw);

    const dir = path.dirname(OUT_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(OUT_PATH, JSON.stringify(config, null, 2), 'utf8');
    console.log('Wrote', OUT_PATH);
  } catch (err) {
    const msg = err.message || String(err);
    if (err.code === 5 || msg.includes('NOT_FOUND')) {
      console.warn('Secret "' + SECRET_NAME + '" not found. Using build-time env or localhost. Run: npm run populate-frontend-secret');
      process.exit(0);
    }
    if (msg.includes('Could not load the default credentials') || msg.includes('Permission') || msg.includes('403')) {
      console.warn('Could not fetch frontend config (no credentials). Using build-time env or localhost.');
      process.exit(0);
    }
    console.error('Failed to fetch secret:', msg);
    process.exit(1);
  }
}

main();
