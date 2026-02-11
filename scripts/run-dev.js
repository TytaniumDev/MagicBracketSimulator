#!/usr/bin/env node
/**
 * Run all dev services. When on Windows with a UNC cwd (e.g. project opened
 * via \\wsl.localhost\...), re-invokes inside WSL so child processes get a
 * valid cwd. Otherwise runs concurrently with repo root as cwd.
 */
const path = require('path');
const { spawn } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');

function uncToWslPath(unc) {
  // \\wsl.localhost\Ubuntu\home\wsl\Dev\... -> /home/wsl/Dev/...
  const match = unc.match(/^\\\\wsl(?:\.localhost|\$)\\[^\\]+(.*)$/);
  if (!match) return null;
  return match[1].replace(/\\/g, '/').replace(/^\/?/, '/');
}

function main() {
  const isWin = process.platform === 'win32';
  const cwd = process.cwd();
  // Detect UNC from cwd or from script location (cwd can be C:\Windows when invoked via INIT_CWD)
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
    console.error('Detected UNC cwd; re-running inside WSL: ' + wslPath);
    // Use only Linux PATH (strip /mnt/ so we don't use Windows npm, which hits UNC cwd issues)
    const wslCmd = `export PATH="$(echo "$PATH" | tr ':' '\\n' | grep -v '^/mnt/' | tr '\\n' ':' | sed 's/:$//')" && cd ${JSON.stringify(wslPath)} && npm run dev:inner`;
    const child = spawn(
      'wsl',
      ['-e', 'bash', '-c', wslCmd],
      { stdio: 'inherit' }
    );
    child.on('exit', (code, signal) => {
      process.exit(code != null ? code : signal ? 128 + signal : 0);
    });
    return;
  }

  // Run concurrently via node (avoids npx/shell "Permission denied" on some setups)
  const concurrentlyPath = path.join(repoRoot, 'node_modules/concurrently/dist/bin/concurrently.js');
  const args = [
    '-n', 'api,frontend',
    '-c', 'green,yellow',
    'npm run api',
    'npm run frontend',
  ];
  const child = spawn(process.execPath, [concurrentlyPath, ...args], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  child.on('exit', (code, signal) => {
    process.exit(code != null ? code : signal ? 128 + signal : 0);
  });
}

main();
