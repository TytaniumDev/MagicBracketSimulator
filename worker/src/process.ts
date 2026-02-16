/**
 * Shared process execution utilities.
 */

import { spawn, ChildProcess } from 'child_process';
import { ProcessResult } from './types.js';

/**
 * Run a process and wait for it to complete.
 * Uses stdio: 'inherit' so output goes to the parent's terminal.
 */
export function runProcess(
  command: string,
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    cwd?: string;
    timeout?: number;
  } = {},
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    let timedOut = false;

    // On macOS, wrap with caffeinate to prevent sleep during execution
    let finalCommand = command;
    let finalArgs = args;
    if (process.platform === 'darwin') {
      finalCommand = 'caffeinate';
      finalArgs = ['-i', command, ...args];
    }

    console.log(`Running: ${finalCommand} ${finalArgs.join(' ')}`);

    const proc: ChildProcess = spawn(finalCommand, finalArgs, {
      stdio: 'inherit',
      env: { ...process.env, ...options.env },
      cwd: options.cwd,
    });

    let timeoutId: NodeJS.Timeout | null = null;
    if (options.timeout) {
      timeoutId = setTimeout(() => {
        timedOut = true;
        console.error(`Process timed out after ${options.timeout}ms, killing...`);
        proc.kill('SIGTERM');
        setTimeout(() => proc.kill('SIGKILL'), 5000);
      }, options.timeout);
    }

    proc.on('error', (error) => {
      if (timeoutId) clearTimeout(timeoutId);
      reject(error);
    });

    proc.on('close', (code, signal) => {
      if (timeoutId) clearTimeout(timeoutId);
      let exitCode: number;
      if (timedOut) {
        exitCode = 124;
      } else if (code !== null) {
        exitCode = code;
      } else if (signal) {
        exitCode = 128 + (signal === 'SIGTERM' ? 15 : signal === 'SIGKILL' ? 9 : 1);
      } else {
        exitCode = 0;
      }
      resolve({ exitCode, duration: Date.now() - startTime });
    });
  });
}
