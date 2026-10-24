const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const { upsertSecretVersion } = require('./lib/secret-manager');

async function main() {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  const secretId = 'worker-host-config';

  const config = {
    sa_key: JSON.parse(process.env.SA_KEY),
    IMAGE_NAME: process.env.IMAGE_NAME,
    GHCR_USER: process.env.GHCR_USER,
    GHCR_TOKEN: process.env.GHCR_TOKEN,
  };

  const client = new SecretManagerServiceClient();
  const result = await upsertSecretVersion(client, projectId, secretId, JSON.stringify(config, null, 2));
  console.log('Done. Secret "' + secretId + '" ' + result + '.');
}

main().catch(err => { console.error(err); process.exit(1); });