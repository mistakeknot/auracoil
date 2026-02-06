/**
 * Oracle CLI Integration
 *
 * Subprocess wrapper for GPT 5.2 Pro access.
 * Uses file-based prompt passing for reliability with complex prompts.
 */

import { execFile, spawn, exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import chalk from 'chalk';

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

export interface OracleOptions {
  prompt: string;
  files?: string[];
  model?: string;
  wait?: boolean;
  timeout?: number;
}

export interface OracleResult {
  success: boolean;
  output: string;
  error?: string;
}

// Environment variables required for Oracle browser automation
const ORACLE_ENV = {
  ...process.env,
  DISPLAY: ':99',
  CHROME_PATH: '/usr/local/bin/google-chrome-wrapper',
};

/**
 * Check if Oracle CLI is available
 */
export async function isOracleAvailable(): Promise<boolean> {
  try {
    await execFileAsync('which', ['oracle']);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get Oracle version
 */
export async function getOracleVersion(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('oracle', ['--version'], {
      env: ORACLE_ENV,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Execute Oracle using spawn with proper streaming
 *
 * Uses spawn instead of exec for better handling of long-running processes
 * and large outputs. This matches how coding agents use Oracle.
 */
export async function executeOracle(options: OracleOptions): Promise<OracleResult> {
  const { prompt, files = [], model = 'gpt-5.2-pro', timeout = 600000 } = options;

  // Validate inputs
  if (!prompt || prompt.trim().length === 0) {
    return { success: false, output: '', error: 'Prompt is required' };
  }

  // Create output file path
  const tempDir = join(tmpdir(), 'auracoil');
  await mkdir(tempDir, { recursive: true });
  const outputFile = join(tempDir, `output-${randomBytes(8).toString('hex')}.md`);

  console.log(chalk.dim(`\n  Oracle: Querying GPT 5.2 Pro...`));
  console.log(chalk.dim(`  Files: ${files.length} file(s)`));

  return new Promise((resolve) => {
    // Build args array - this is how coding agents pass to Oracle
    const args: string[] = [
      '--wait',
      '--force',  // Avoid duplicate session detection
      '-p', prompt,
      '-m', model,
      '--write-output', outputFile,
    ];

    // Add files
    if (files.length > 0) {
      args.push('-f', ...files);
    }

    console.log(chalk.dim(`  Running: oracle --wait -p <prompt> -m ${model} -f <${files.length} files>`));

    const child = spawn('oracle', args, {
      env: ORACLE_ENV,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeout);

    child.stdout.on('data', (data) => {
      const chunk = data.toString();
      stdout += chunk;
      // Show progress to user
      if (chunk.includes('Launching') || chunk.includes('Answer:')) {
        console.log(chalk.dim(`  ${chunk.trim().split('\n')[0]}`));
      }
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', async (code) => {
      clearTimeout(timer);

      if (timedOut) {
        resolve({
          success: false,
          output: '',
          error: `Oracle timed out after ${timeout / 1000}s`,
        });
        return;
      }

      // Try to read output from file first (more reliable)
      let output = stdout;
      try {
        const { readFile } = await import('fs/promises');
        const fileContent = await readFile(outputFile, 'utf-8');
        if (fileContent.trim()) {
          output = fileContent;
        }
      } catch {
        // File doesn't exist, use stdout
      }

      // Extract answer from Oracle output if present
      const answerMatch = output.match(/Answer:\n([\s\S]*?)(?:\n\n\d+.*tokens|$)/);
      if (answerMatch) {
        output = answerMatch[1].trim();
      }

      if (code === 0) {
        resolve({
          success: true,
          output,
        });
      } else {
        // Include helpful error info
        const errorInfo = stderr || stdout || `Oracle exited with code ${code}`;
        resolve({
          success: false,
          output: '',
          error: errorInfo,
        });
      }

      // Cleanup
      try {
        await unlink(outputFile);
      } catch {
        // Ignore
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        success: false,
        output: '',
        error: err.message,
      });
    });
  });
}

/**
 * Execute Oracle with streaming output (for long-running analyses)
 */
export function executeOracleStreaming(
  options: OracleOptions,
  onData: (chunk: string) => void,
  onError: (error: string) => void,
  onComplete: () => void
): void {
  const { prompt, files = [], model = 'gpt-5.2-pro' } = options;

  const args: string[] = [
    '--wait',
    '-p', prompt,
    '-m', model,
  ];

  if (files.length > 0) {
    args.push('-f', ...files);
  }

  const child = spawn('oracle', args, {
    env: ORACLE_ENV,
  });

  child.stdout.on('data', (data) => {
    onData(data.toString());
  });

  child.stderr.on('data', (data) => {
    const msg = data.toString();
    if (!msg.includes('Warning')) {
      onError(msg);
    }
  });

  child.on('close', () => {
    onComplete();
  });

  child.on('error', (error) => {
    onError(error.message);
  });
}
