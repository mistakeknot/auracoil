/**
 * Diff Command
 *
 * Show diff between latest review output and current AGENTS.md.
 */

import { readdir, readFile } from 'fs/promises';
import { join, basename } from 'path';
import { execFileSync } from 'child_process';
import chalk from 'chalk';

interface DiffOptions {
  file?: string;
}

export async function diffCommand(options: DiffOptions): Promise<void> {
  const cwd = process.cwd();
  const reviewDir = join(cwd, '.auracoil', 'reviews');

  console.log(chalk.cyan('\n  Auracoil Diff\n'));

  // Find the review file to diff
  let sourceFile: string;

  if (options.file) {
    sourceFile = join(reviewDir, options.file);
  } else {
    try {
      const files = await readdir(reviewDir);
      const reviewFiles = files
        .filter(f => f.startsWith('review-') && f.endsWith('.json'))
        .sort()
        .reverse();

      if (reviewFiles.length === 0) {
        console.log(chalk.yellow('  No review files found.'));
        console.log(chalk.dim('  Run `auracoil review` first.\n'));
        process.exit(1);
      }

      sourceFile = join(reviewDir, reviewFiles[0]);
      console.log(chalk.dim(`  Comparing: ${basename(sourceFile)} → AGENTS.md\n`));
    } catch {
      console.log(chalk.yellow('  No .auracoil/reviews/ directory found.'));
      console.log(chalk.dim('  Run `auracoil review` first.\n'));
      process.exit(1);
    }
  }

  const destFile = join(cwd, 'AGENTS.md');

  // Check if current AGENTS.md exists
  try {
    await readFile(destFile, 'utf-8');
  } catch {
    console.log(chalk.dim('  AGENTS.md does not exist yet.'));
    console.log(chalk.dim('  Run /interdoc first to create one.\n'));
    return;
  }

  // Show review content
  try {
    const reviewContent = await readFile(sourceFile, 'utf-8');
    console.log(chalk.dim('  Latest review output:'));
    console.log(chalk.dim('  ' + '-'.repeat(50)));
    console.log(reviewContent);
    console.log(chalk.dim('  ' + '-'.repeat(50)));
    console.log(chalk.cyan('\n  To apply: auracoil apply\n'));
  } catch {
    console.log(chalk.red(`  ✗ Error reading review file: ${sourceFile}`));
    process.exit(1);
  }
}
