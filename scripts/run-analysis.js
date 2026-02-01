#!/usr/bin/env node
/**
 * Run the analysis service (uv) from analysis-service/ regardless of
 * process cwd. Fixes UNC path issues when running from Windows with project in WSL.
 */
const path = require('path');
const { spawn } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const analysisDir = path.join(rootDir, 'analysis-service');

const proc = spawn('uv', ['run', 'uvicorn', 'main:app', '--reload'], {
  cwd: analysisDir,
  stdio: 'inherit',
  shell: true,
});

proc.on('exit', (code, signal) => {
  process.exit(code != null ? code : signal ? 128 + signal : 0);
});
