#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { initCommand } from './commands/init.js';
import { generateCommand } from './commands/generate.js';
import { updateCommand } from './commands/update.js';
import { captureCommand } from './commands/capture.js';
import { searchCommand } from './commands/search.js';
import { healthCommand } from './commands/health.js';
import { applyCommand } from './commands/apply.js';
import { diffCommand } from './commands/diff.js';

const program = new Command();

program
  .name('auracoil')
  .description('Coding quality amplifier using GPT 5.2 Pro via Oracle')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize Auracoil config with safe defaults')
  .option('-f, --force', 'Overwrite existing configuration')
  .action(initCommand);

program
  .command('generate')
  .description('Generate AGENTS.md using GPT 5.2 Pro (Oracle required)')
  .option('--dry-run', 'Show what would be generated without writing')
  .option('--no-cache', 'Bypass content hash cache')
  .option('--apply', 'Write directly to repo root (default: save to .auracoil/generated/ for review)')
  .action(generateCommand);

program
  .command('update')
  .description('Incremental update - GPT re-analyzes changed areas only')
  .option('--force', 'Force full regeneration')
  .action(updateCommand);

program
  .command('capture')
  .description('Capture a solved problem (template-based, no LLM required)')
  .option('-c, --category <category>', 'Solution category')
  .option('-t, --title <title>', 'Solution title')
  .action(captureCommand);

program
  .command('search <query>')
  .description('Search captured solutions (ripgrep-based)')
  .option('-c, --category <category>', 'Filter by category')
  .action(searchCommand);

program
  .command('health')
  .description('Show documentation coverage and staleness metrics')
  .action(healthCommand);

program
  .command('apply')
  .description('Apply generated AGENTS.md from .auracoil/generated/ to repo root')
  .option('-f, --file <filename>', 'Specific generated file to apply (defaults to latest)')
  .action(applyCommand);

program
  .command('diff')
  .description('Show diff between generated AGENTS.md and current version')
  .option('-f, --file <filename>', 'Specific generated file to compare (defaults to latest)')
  .action(diffCommand);

// Parse arguments
program.parse();

// Show help if no command provided
if (!process.argv.slice(2).length) {
  console.log(chalk.cyan('\n  Auracoil - Coding quality amplifier\n'));
  console.log(chalk.dim('  Uses GPT 5.2 Pro (via Oracle) to generate enhanced documentation'));
  console.log(chalk.dim('  that helps Claude Code and Codex CLI work more effectively.\n'));
  program.outputHelp();
}
