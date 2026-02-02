#!/usr/bin/env node
/**
 * Run the analysis service (uv) from analysis-service/ regardless of
 * process cwd. Fixes UNC path issues when running from Windows with project in WSL.
 * If `uv` is not installed, keeps process alive so dev can run without analysis.
 */
const path = require('path');
const { spawn, execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const analysisDir = path.join(rootDir, 'analysis-service');

function hasUv() {
  try {
    execSync('uv --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

if (!hasUv()) {
  console.error('[analysis] uv not found. Analysis service (port 8000) skipped. Install uv to enable AI analysis.');
  process.stdin.resume();
  return;
}

const proc = spawn('uv', ['run', 'uvicorn', 'main:app', '--reload'], {
  cwd: analysisDir,
  stdio: 'inherit',
  shell: true,
});

proc.on('exit', (code, signal) => {
  process.exit(code != null ? code : signal ? 128 + signal : 0);
});
