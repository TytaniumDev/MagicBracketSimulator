const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

async function main() {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  const secretId = 'worker-host-config';
  const parent = 'projects/' + projectId;
  const fullName = parent + '/secrets/' + secretId;

  const config = {
    sa_key: JSON.parse(process.env.SA_KEY),
    IMAGE_NAME: process.env.IMAGE_NAME,
    GHCR_USER: process.env.GHCR_USER,
    GHCR_TOKEN: process.env.GHCR_TOKEN,
  };

  const client = new SecretManagerServiceClient();
  const payload = Buffer.from(JSON.stringify(config, null, 2), 'utf8');

  // Create secret if it doesn't exist
  try {
    await client.getSecret({ name: fullName });
  } catch (e) {
    if (e.code === 5 || (e.message && e.message.includes('NOT_FOUND'))) {
      await client.createSecret({
        parent,
        secretId,
        secret: { replication: { automatic: {} } },
      });
      console.log('Created secret: ' + secretId);
    } else {
      throw e;
    }
  }

  const [version] = await client.addSecretVersion({
    parent: fullName,
    payload: { data: payload },
  });
  const versionNum = version.name?.split('/').pop() ?? 'latest';
  console.log('Done. Secret "' + secretId + '" updated (version: ' + versionNum + ').');
}

main().catch(err => { console.error(err); process.exit(1); });