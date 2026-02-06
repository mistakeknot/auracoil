#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { reviewCommand } from './commands/review.js';
import { healthCommand } from './commands/health.js';
import { applyCommand } from './commands/apply.js';
import { diffCommand } from './commands/diff.js';

const program = new Command();

program
  .name('auracoil')
  .description('GPT 5.2 Pro reviewer for AGENTS.md — accretive documentation enhancement')
  .version('0.2.0');

program
  .command('review')
  .description('Send existing AGENTS.md to GPT 5.2 Pro for review (Oracle required)')
  .option('--skip-preflight', 'Skip Oracle session health check')
  .action(reviewCommand);

program
  .command('health')
  .description('Show documentation staleness and review history')
  .action(healthCommand);

program
  .command('diff')
  .description('Show diff between latest review suggestions and current AGENTS.md')
  .option('-f, --file <filename>', 'Specific review file to compare')
  .action(diffCommand);

program
  .command('apply')
  .description('Apply approved suggestions to AGENTS.md Auracoil region')
  .option('-f, --file <filename>', 'Specific review file to apply')
  .action(applyCommand);

program.parse();

if (!process.argv.slice(2).length) {
  console.log(chalk.cyan('\n  Auracoil — GPT 5.2 Pro reviewer for AGENTS.md\n'));
  console.log(chalk.dim('  Accretively enhances documentation using cross-AI review.'));
  console.log(chalk.dim('  Works alongside Interdoc — each owns its own region.\n'));
  program.outputHelp();
}
