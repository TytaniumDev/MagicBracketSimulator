#!/usr/bin/env node
/**
 * Sync the API's secrets from Doppler into GCP Secret Manager.
 *
 * Doppler is the source of truth. Firebase App Hosting can only read secrets
 * from GCP Secret Manager, so this copies every secret that
 * api/apphosting.yaml references (`- variable: NAME` / `secret: id`) from the
 * Doppler key of the same NAME into the GCP secret `id`. Keys missing from
 * Doppler are skipped, and a secret whose value is unchanged gets no new
 * version. Values are never printed.
 *
 * Usage (reads the Doppler config as JSON on stdin):
 *   doppler secrets download --no-file --format json | node scripts/sync-api-secrets.js
 *   ... | node scripts/sync-api-secrets.js --dry-run   # list what would sync
 *
 * Requires GOOGLE_CLOUD_PROJECT and credentials with Secret Manager Admin.
 * App Hosting picks up new versions on its next rollout.
 */

const fs = require('fs');
const path = require('path');

const APPHOSTING_YAML = path.join(__dirname, '..', 'api', 'apphosting.yaml');

/** [{ variable, secret }] for each env entry in apphosting.yaml that uses a secret. */
function parseSecretRefs(yamlText) {
  const refs = [];
  const entry = /-\s*variable:\s*(\S+)\s*\n\s*secret:\s*(\S+)/g;
  let match;
  while ((match = entry.exec(yamlText)) !== null) {
    refs.push({ variable: match[1], secret: match[2] });
  }
  return refs;
}

/**
 * Map each GCP secret id to the Doppler value to store. Several variables may
 * share one secret (e.g. SENTRY_DSN and NEXT_PUBLIC_SENTRY_DSN); the first one
 * present in Doppler wins, and differing values are an error.
 */
function planSync(refs, dopplerSecrets) {
  const plan = new Map(); // secretId -> { variable, value }
  for (const { variable, secret } of refs) {
    const value = dopplerSecrets[variable];
    if (value === undefined || value === '') continue;
    const existing = plan.get(secret);
    if (existing && existing.value !== value) {
      throw new Error(`${existing.variable} and ${variable} both map to "${secret}" but differ in Doppler`);
    }
    if (!existing) plan.set(secret, { variable, value });
  }
  const skipped = refs.filter(({ secret }) => !plan.has(secret));
  return { plan, skipped };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const dopplerSecrets = JSON.parse(fs.readFileSync(0, 'utf8'));
  const refs = parseSecretRefs(fs.readFileSync(APPHOSTING_YAML, 'utf8'));
  const { plan, skipped } = planSync(refs, dopplerSecrets);

  for (const { variable, secret } of skipped) console.log(`skip     ${variable} -> ${secret} (not in Doppler)`);

  if (dryRun) {
    for (const [secret, { variable }] of plan) console.log(`would sync ${variable} -> ${secret}`);
    return;
  }

  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  if (!projectId) throw new Error('GOOGLE_CLOUD_PROJECT is not set');

  const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
  const { upsertSecretVersion } = require('./lib/secret-manager');
  const client = new SecretManagerServiceClient();

  for (const [secret, { variable, value }] of plan) {
    const result = await upsertSecretVersion(client, projectId, secret, value, { onlyIfChanged: true });
    console.log(`${result.padEnd(8)} ${variable} -> ${secret}`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}

module.exports = { parseSecretRefs, planSync };
