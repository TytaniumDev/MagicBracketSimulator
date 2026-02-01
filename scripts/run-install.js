#!/usr/bin/env node
/**
 * Install root and subproject dependencies. When on Windows with a UNC cwd,
 * re-invokes inside WSL so npm runs with a valid cwd.
 */
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');

function uncToWslPath(unc) {
  const match = unc.match(/^\\\\wsl(?:\.localhost|\$)\\[^\\]+(.*)$/);
  if (!match) return null;
  return match[1].replace(/\\/g, '/').replace(/^\/?/, '/');
}

function main() {
  const isWin = process.platform === 'win32';
  const cwd = process.cwd();
  const isUnc = isWin && (
    cwd.startsWith('\\\\') || cwd.startsWith('//') ||
    __dirname.startsWith('\\\\') || __dirname.startsWith('//')
  );

  if (isUnc) {
    const wslPath = uncToWslPath(repoRoot);
    if (!wslPath) {
      console.error('Could not convert UNC path to WSL path:', cwd);
      process.exit(1);
    }
    console.error('Detected UNC cwd; re-running install inside WSL: ' + wslPath);
    const wslCmd = [
      'export PATH="$(echo "$PATH" | tr \':\' \'\\n\' | grep -v \'^/mnt/\' | tr \'\\n\' \':\' | sed \'s/:$//\')"',
      `cd ${JSON.stringify(wslPath)}`,
      'npm install',
      'npm install --prefix orchestrator-service',
      'npm install --prefix frontend',
      'npm install --prefix forge-log-analyzer',
    ].join(' && ');
    const r = spawnSync('wsl', ['-e', 'bash', '-c', wslCmd], { stdio: 'inherit' });
    process.exit(r.status != null ? r.status : r.signal ? 128 + r.signal : 0);
    return;
  }

  const opts = { cwd: repoRoot, stdio: "inherit" };
  let r = spawnSync('npm', ['install'], opts);
  if (r.status !== 0) process.exit(r.status != null ? r.status : 1);
  r = spawnSync('npm', ['install', '--prefix', 'orchestrator-service'], opts);
  if (r.status !== 0) process.exit(r.status != null ? r.status : 1);
  r = spawnSync('npm', ['install', '--prefix', 'frontend'], opts);
  if (r.status !== 0) process.exit(r.status != null ? r.status : 1);
  r = spawnSync('npm', ['install', '--prefix', 'forge-log-analyzer'], opts);
  if (r.status !== 0) process.exit(r.status != null ? r.status : 1);
}

main();
