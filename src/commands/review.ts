/**
 * Review Command
 *
 * The core Auracoil v2 command: gather evidence, send to GPT for review,
 * save structured suggestions. GPT acts as critic, not generator.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import chalk from 'chalk';
import { simpleGit } from 'simple-git';
import { checkOracleSession, executeOracle } from '../integrations/oracle.js';
import { indexRepository } from '../analyzer/repo-indexer.js';
import { buildAnalysisBundle, getBundleFiles } from '../analyzer/context-builder.js';
import { scanForSecrets } from '../security/secret-scanner.js';
import { buildReviewPrompt } from '../prompts/review-prompt.js';
import { extractRegion } from '../regions/region-parser.js';
import { StateManager } from '../state/state-manager.js';

interface ReviewOptions {
  skipPreflight?: boolean;
}

export async function reviewCommand(options: ReviewOptions): Promise<void> {
  const cwd = process.cwd();

  console.log(chalk.cyan('\n  Auracoil Review\n'));

  // Step 1: Pre-flight check
  if (!options.skipPreflight) {
    console.log(chalk.dim('  Checking Oracle session...'));
    const health = await checkOracleSession();
    if (!health.available) {
      console.log(chalk.red(`\n  \u2717 ${health.message}`));
      console.log(chalk.dim('    Fix Oracle, then retry. Use --skip-preflight to bypass.\n'));
      process.exit(1);
    }
    console.log(chalk.green('  \u2713 Oracle session active'));
  }

  // Step 2: Read existing AGENTS.md
  const agentsPath = join(cwd, 'AGENTS.md');
  let agentsMd: string;
  try {
    agentsMd = await readFile(agentsPath, 'utf-8');
  } catch {
    console.log(chalk.yellow('  No AGENTS.md found \u2014 run /interdoc or create one first.\n'));
    process.exit(1);
  }

  // Step 3: Extract Auracoil region (or note it's missing)
  const existingRegion = extractRegion(agentsMd);
  const regionContent = existingRegion || '(No Auracoil region yet \u2014 first review)';

  // Step 4: Load state and gather evidence
  const state = new StateManager(cwd);
  const stateData = await state.load();

  console.log(chalk.dim('  Gathering evidence...'));

  const git = simpleGit(cwd);
  let changedFiles: string[] = [];
  let commitMessages: string[] = [];

  try {
    if (stateData.lastReviewedCommit) {
      const diff = await git.diff(['--name-only', `${stateData.lastReviewedCommit}..HEAD`]);
      changedFiles = diff.split('\n').filter(Boolean);
      const log = await git.log({ from: stateData.lastReviewedCommit, to: 'HEAD' });
      commitMessages = log.all.map(c => c.message);
    } else {
      const log = await git.log({ maxCount: 20 });
      commitMessages = log.all.map(c => c.message);
    }
  } catch {
    console.log(chalk.dim('  No git history available'));
  }

  console.log(chalk.dim(`  ${changedFiles.length} files changed, ${commitMessages.length} commits`));

  // Step 5: Index repo and build file bundle
  console.log(chalk.dim('  Indexing repository...'));
  const index = await indexRepository(cwd);
  const bundle = await buildAnalysisBundle(cwd, index);
  const files = getBundleFiles(bundle);

  // Step 6: Security scan
  const scanResult = await scanForSecrets(cwd, files);
  const safeFiles = scanResult.safe
    ? files
    : files.filter(f => !scanResult.issues.some(i => i.file === f));

  // Step 7: Build review prompt
  const repoName = cwd.split('/').pop() || 'unknown';
  const prompt = buildReviewPrompt({
    existingAgentsMd: regionContent,
    changedFiles,
    commitMessages,
    repoName,
    languages: index.languages.map(l => l.name),
  });

  // Step 8: Send to GPT via Oracle
  console.log(chalk.cyan('\n  Sending to GPT 5.2 Pro for review...'));
  console.log(chalk.dim('  This may take 5-15 minutes.\n'));

  const result = await executeOracle({
    prompt,
    files: safeFiles.map(f => join(cwd, f)),
    model: 'gpt-5.2-pro',
    timeout: 1800000, // 30 minutes
  });

  if (!result.success) {
    console.log(chalk.red(`\n  \u2717 Review failed: ${result.error}\n`));
    process.exit(1);
  }

  // Step 9: Save raw review output
  const reviewDir = join(cwd, '.auracoil', 'reviews');
  await mkdir(reviewDir, { recursive: true });
  const date = new Date().toISOString().split('T')[0];
  const reviewPath = join(reviewDir, `review-${date}.json`);
  await writeFile(reviewPath, result.output);
  console.log(chalk.green(`  \u2713 Review saved to ${reviewPath}`));

  // Step 10: Update state
  let headCommit: string | null = null;
  try {
    const log = await git.log({ maxCount: 1 });
    headCommit = log.latest?.hash || null;
  } catch { /* not a git repo */ }

  await state.update({
    lastReviewedCommit: headCommit,
    lastReviewedAt: new Date().toISOString(),
  });

  // Step 11: Summary
  console.log(chalk.cyan('\n  Review complete!'));
  console.log(chalk.dim('  The agent will present suggestions for your approval.\n'));
}
