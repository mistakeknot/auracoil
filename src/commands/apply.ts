/**
 * Apply Command
 *
 * Apply review suggestions to AGENTS.md Auracoil region.
 * Reads from .auracoil/reviews/ instead of .auracoil/generated/.
 */

import { readdir, readFile, writeFile } from 'fs/promises';
import { join, basename } from 'path';
import chalk from 'chalk';
import { extractRegion, replaceRegion, ensureRegion } from '../regions/region-parser.js';

interface ApplyOptions {
  file?: string;
}

export async function applyCommand(options: ApplyOptions): Promise<void> {
  const cwd = process.cwd();
  const reviewDir = join(cwd, '.auracoil', 'reviews');

  console.log(chalk.cyan('\n  Auracoil Apply\n'));

  // Find the review file
  let reviewFile: string;

  if (options.file) {
    reviewFile = join(reviewDir, options.file);
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

      reviewFile = join(reviewDir, reviewFiles[0]);
      console.log(chalk.dim(`  Using latest: ${basename(reviewFile)}`));
    } catch {
      console.log(chalk.yellow('  No .auracoil/reviews/ directory found.'));
      console.log(chalk.dim('  Run `auracoil review` first.\n'));
      process.exit(1);
    }
  }

  // Read review content
  let reviewContent: string;
  try {
    reviewContent = await readFile(reviewFile, 'utf-8');
  } catch {
    console.log(chalk.red(`  ✗ File not found: ${reviewFile}`));
    process.exit(1);
  }

  // Read current AGENTS.md
  const agentsPath = join(cwd, 'AGENTS.md');
  let agentsMd: string;
  try {
    agentsMd = await readFile(agentsPath, 'utf-8');
  } catch {
    console.log(chalk.yellow('  No AGENTS.md found.'));
    console.log(chalk.dim('  Run /interdoc first to create one.\n'));
    process.exit(1);
  }

  // Ensure Auracoil region exists
  agentsMd = ensureRegion(agentsMd);

  // For now, save the review content as the region
  // (In production, the agent parses suggestions and applies selectively)
  const updatedDoc = replaceRegion(agentsMd, reviewContent);
  await writeFile(agentsPath, updatedDoc);

  console.log(chalk.green('  ✓ Review applied to AGENTS.md Auracoil region'));
  console.log(chalk.dim('  Only the Auracoil section was modified.\n'));
}
