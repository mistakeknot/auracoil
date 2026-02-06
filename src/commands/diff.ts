/**
 * Diff Command
 *
 * Show diff between generated AGENTS.md and current repo version.
 */

import { readdir, readFile } from 'fs/promises';
import { join, basename } from 'path';
import { execFileSync } from 'child_process';
import chalk from 'chalk';

interface DiffOptions {
  file?: string;  // Specific file to diff (defaults to latest)
}

export async function diffCommand(options: DiffOptions): Promise<void> {
  const cwd = process.cwd();
  const generatedDir = join(cwd, '.auracoil', 'generated');

  console.log(chalk.cyan('\n  Auracoil Diff\n'));

  // Find the file to diff
  let sourceFile: string;

  if (options.file) {
    sourceFile = join(generatedDir, options.file);
  } else {
    // Find latest generated file
    try {
      const files = await readdir(generatedDir);
      const agentFiles = files
        .filter(f => f.startsWith('AGENTS.') && f.endsWith('.md'))
        .sort()
        .reverse();

      if (agentFiles.length === 0) {
        console.log(chalk.yellow('  No generated files found.'));
        console.log(chalk.dim('  Run `auracoil generate` first.\n'));
        process.exit(1);
      }

      sourceFile = join(generatedDir, agentFiles[0]);
      console.log(chalk.dim(`  Comparing: ${basename(sourceFile)} → AGENTS.md\n`));
    } catch {
      console.log(chalk.yellow('  No .auracoil/generated/ directory found.'));
      console.log(chalk.dim('  Run `auracoil generate` first.\n'));
      process.exit(1);
    }
  }

  const destFile = join(cwd, 'AGENTS.md');

  // Check if current AGENTS.md exists
  try {
    await readFile(destFile, 'utf-8');
  } catch {
    console.log(chalk.dim('  AGENTS.md does not exist yet.'));
    console.log(chalk.dim('  Run `auracoil apply` to create it.\n'));

    // Show preview of what would be created
    const content = await readFile(sourceFile, 'utf-8');
    const lines = content.split('\n').slice(0, 30);
    console.log(chalk.dim('  Preview (first 30 lines):'));
    console.log(chalk.dim('  ' + '-'.repeat(50)));
    for (const line of lines) {
      console.log(chalk.green(`  + ${line}`));
    }
    console.log(chalk.dim('  ...'));
    console.log(chalk.dim('  ' + '-'.repeat(50)));
    return;
  }

  // Run diff using execFileSync (safer than execSync with shell)
  try {
    const diff = execFileSync('diff', ['-u', destFile, sourceFile], {
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024,
    });

    // If we get here with no error, files are identical (diff returns 0)
    console.log(chalk.green('  ✓ No differences - files are identical.\n'));
  } catch (error: unknown) {
    // diff exits with 1 when files differ, which throws an error
    // We need to check if it's just a diff result or an actual error
    const execError = error as { status?: number; stdout?: string; stderr?: string };

    if (execError.status === 1 && execError.stdout) {
      // Files differ - this is expected, show the diff
      const diff = execError.stdout;
      const lines = diff.split('\n');
      for (const line of lines) {
        if (line.startsWith('+++') || line.startsWith('---')) {
          console.log(chalk.dim(line));
        } else if (line.startsWith('+')) {
          console.log(chalk.green(line));
        } else if (line.startsWith('-')) {
          console.log(chalk.red(line));
        } else if (line.startsWith('@@')) {
          console.log(chalk.cyan(line));
        } else {
          console.log(line);
        }
      }

      console.log(chalk.cyan('\n  To apply these changes:'));
      console.log(chalk.dim('    auracoil apply\n'));
    } else {
      // Actual error
      console.log(chalk.red(`  ✗ Error running diff: ${error}`));
      process.exit(1);
    }
  }
}
