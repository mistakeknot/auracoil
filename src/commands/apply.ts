/**
 * Apply Command
 *
 * Apply generated AGENTS.md from .auracoil/generated/ to the repo root.
 * User reviews the draft first, then runs this to commit the change.
 */

import { readdir, readFile, writeFile, copyFile } from 'fs/promises';
import { join, basename } from 'path';
import chalk from 'chalk';
import { isPointerClaudeMd, writeClaudeMdPointer } from '../generator/claude-md-pointer.js';

interface ApplyOptions {
  file?: string;  // Specific file to apply (defaults to latest)
}

export async function applyCommand(options: ApplyOptions): Promise<void> {
  const cwd = process.cwd();
  const generatedDir = join(cwd, '.auracoil', 'generated');

  console.log(chalk.cyan('\n  Auracoil Apply\n'));

  // Find the file to apply
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
      console.log(chalk.dim(`  Using latest: ${basename(sourceFile)}`));
    } catch {
      console.log(chalk.yellow('  No .auracoil/generated/ directory found.'));
      console.log(chalk.dim('  Run `auracoil generate` first.\n'));
      process.exit(1);
    }
  }

  // Read the generated content
  let content: string;
  try {
    content = await readFile(sourceFile, 'utf-8');
  } catch {
    console.log(chalk.red(`  ✗ File not found: ${sourceFile}`));
    process.exit(1);
  }

  // Write to AGENTS.md
  const destPath = join(cwd, 'AGENTS.md');
  await writeFile(destPath, content);
  console.log(chalk.green(`  ✓ Written ${destPath}`));

  // Write CLAUDE.md pointer (only if not custom)
  const isPointer = await isPointerClaudeMd(cwd);
  if (isPointer) {
    await writeClaudeMdPointer(cwd, {});
  } else {
    console.log(chalk.dim('  Skipping CLAUDE.md (has custom content)'));
  }

  console.log(chalk.cyan('\n  Changes applied!\n'));
}
