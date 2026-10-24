/**
 * Small helpers around GCP Secret Manager shared by the populate/sync scripts.
 */

const NOT_FOUND = 5;

function isNotFound(err) {
  return err && (err.code === NOT_FOUND || (err.message && err.message.includes('NOT_FOUND')));
}

/** Create the secret (automatic replication) if it does not exist yet. */
async function ensureSecret(client, projectId, secretId) {
  const name = `projects/${projectId}/secrets/${secretId}`;
  try {
    await client.getSecret({ name });
    return false;
  } catch (err) {
    if (!isNotFound(err)) throw err;
    await client.createSecret({
      parent: `projects/${projectId}`,
      secretId,
      secret: { replication: { automatic: {} } },
    });
    return true;
  }
}

/** The latest version's value as a string, or null when there is none. */
async function readLatest(client, projectId, secretId) {
  try {
    const [version] = await client.accessSecretVersion({
      name: `projects/${projectId}/secrets/${secretId}/versions/latest`,
    });
    return version.payload.data.toString('utf8');
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

/**
 * Store `value` as a new version of `secretId`, creating the secret if needed.
 * With `onlyIfChanged`, skips the write when the latest version already
 * holds the same value. Returns 'created' | 'updated' | 'unchanged'.
 */
async function upsertSecretVersion(client, projectId, secretId, value, { onlyIfChanged = false } = {}) {
  const created = await ensureSecret(client, projectId, secretId);
  if (!created && onlyIfChanged && (await readLatest(client, projectId, secretId)) === value) {
    return 'unchanged';
  }
  await client.addSecretVersion({
    parent: `projects/${projectId}/secrets/${secretId}`,
    payload: { data: Buffer.from(value, 'utf8') },
  });
  return created ? 'created' : 'updated';
}

module.exports = { ensureSecret, readLatest, upsertSecretVersion };
