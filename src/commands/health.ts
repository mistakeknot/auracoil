/**
 * Health Command
 *
 * Show documentation coverage and staleness metrics.
 */

import { access, readFile, stat } from 'fs/promises';
import { join } from 'path';
import chalk from 'chalk';
import { glob } from 'glob';
import { indexRepository } from '../analyzer/repo-indexer.js';
import { isOracleAvailable, getOracleVersion } from '../integrations/oracle.js';

interface HealthMetrics {
  hasAgentsMd: boolean;
  hasClaudeMd: boolean;
  agentsMdAge?: number;  // days
  claudeMdAge?: number;
  indexAge?: number;
  coverage: CoverageMetrics;
  staleness: StalenessMetrics;
}

interface CoverageMetrics {
  languagesCovered: number;
  totalLanguages: number;
  frameworksCovered: number;
  totalFrameworks: number;
  solutionCount: number;
}

interface StalenessMetrics {
  filesChangedSinceIndex: number;
  daysStale: number;
  needsUpdate: boolean;
}

export async function healthCommand(): Promise<void> {
  const cwd = process.cwd();

  console.log(chalk.cyan('\n  Auracoil Health Check\n'));

  // Check Oracle
  const oracleAvailable = await isOracleAvailable();
  if (oracleAvailable) {
    const version = await getOracleVersion();
    console.log(chalk.green(`  ✓ Oracle CLI: ${version}`));
  } else {
    console.log(chalk.red('  ✗ Oracle CLI: Not found'));
    console.log(chalk.dim('    Install with: npm i -g @steipete/oracle'));
  }

  // Check initialization
  const auracoilDir = join(cwd, '.auracoil');
  let initialized = false;
  try {
    await access(join(auracoilDir, 'config.yaml'));
    initialized = true;
    console.log(chalk.green('  ✓ Auracoil: Initialized'));
  } catch {
    console.log(chalk.yellow('  ⚠ Auracoil: Not initialized'));
    console.log(chalk.dim('    Run `auracoil init` first\n'));
    return;
  }

  // Check documentation files
  const metrics = await gatherMetrics(cwd);

  console.log('');
  console.log(chalk.dim('  Documentation:'));

  if (metrics.hasAgentsMd) {
    const ageStr = metrics.agentsMdAge !== undefined
      ? chalk.dim(` (${formatAge(metrics.agentsMdAge)})`)
      : '';
    console.log(chalk.green(`    ✓ AGENTS.md${ageStr}`));
  } else {
    console.log(chalk.yellow('    ⚠ AGENTS.md: Not found'));
  }

  if (metrics.hasClaudeMd) {
    const ageStr = metrics.claudeMdAge !== undefined
      ? chalk.dim(` (${formatAge(metrics.claudeMdAge)})`)
      : '';
    console.log(chalk.green(`    ✓ CLAUDE.md${ageStr}`));
  } else {
    console.log(chalk.yellow('    ⚠ CLAUDE.md: Not found'));
  }

  // Coverage
  console.log('');
  console.log(chalk.dim('  Coverage:'));
  console.log(`    Languages:  ${metrics.coverage.languagesCovered}/${metrics.coverage.totalLanguages}`);
  console.log(`    Frameworks: ${metrics.coverage.frameworksCovered}/${metrics.coverage.totalFrameworks}`);
  console.log(`    Solutions:  ${metrics.coverage.solutionCount} captured`);

  // Staleness
  console.log('');
  console.log(chalk.dim('  Staleness:'));

  if (metrics.staleness.needsUpdate) {
    console.log(chalk.yellow(`    ⚠ ${metrics.staleness.filesChangedSinceIndex} files changed since last index`));
    console.log(chalk.dim(`      Last indexed: ${formatAge(metrics.staleness.daysStale)} ago`));
    console.log(chalk.dim('      Run `auracoil update` to refresh'));
  } else {
    console.log(chalk.green('    ✓ Documentation is up to date'));
  }

  // Summary
  console.log('');
  if (!metrics.hasAgentsMd) {
    console.log(chalk.cyan('  → Run `auracoil generate` to create AGENTS.md'));
  } else if (metrics.staleness.needsUpdate) {
    console.log(chalk.cyan('  → Run `auracoil update` to refresh documentation'));
  } else {
    console.log(chalk.green('  All good!'));
  }
  console.log('');
}

async function gatherMetrics(cwd: string): Promise<HealthMetrics> {
  const metrics: HealthMetrics = {
    hasAgentsMd: false,
    hasClaudeMd: false,
    coverage: {
      languagesCovered: 0,
      totalLanguages: 0,
      frameworksCovered: 0,
      totalFrameworks: 0,
      solutionCount: 0,
    },
    staleness: {
      filesChangedSinceIndex: 0,
      daysStale: 0,
      needsUpdate: false,
    },
  };

  // Check AGENTS.md
  try {
    const agentsStat = await stat(join(cwd, 'AGENTS.md'));
    metrics.hasAgentsMd = true;
    metrics.agentsMdAge = daysSince(agentsStat.mtime);
  } catch {
    // Not found
  }

  // Check CLAUDE.md
  try {
    const claudeStat = await stat(join(cwd, 'CLAUDE.md'));
    metrics.hasClaudeMd = true;
    metrics.claudeMdAge = daysSince(claudeStat.mtime);
  } catch {
    // Not found
  }

  // Index repo for coverage metrics
  try {
    const index = await indexRepository(cwd);
    metrics.coverage.totalLanguages = index.languages.length;
    metrics.coverage.totalFrameworks = index.frameworks.length;

    // Check if AGENTS.md mentions these
    if (metrics.hasAgentsMd) {
      const agentsContent = await readFile(join(cwd, 'AGENTS.md'), 'utf-8');
      const agentsLower = agentsContent.toLowerCase();

      for (const lang of index.languages) {
        if (agentsLower.includes(lang.name.toLowerCase())) {
          metrics.coverage.languagesCovered++;
        }
      }

      for (const framework of index.frameworks) {
        if (agentsLower.includes(framework.toLowerCase())) {
          metrics.coverage.frameworksCovered++;
        }
      }
    }
  } catch {
    // Index failed
  }

  // Check solutions
  try {
    const solutions = await glob('**/*.md', {
      cwd: join(cwd, '.auracoil/solutions'),
      nodir: true,
    });
    metrics.coverage.solutionCount = solutions.length;
  } catch {
    // No solutions
  }

  // Check staleness
  try {
    const indexPath = join(cwd, '.auracoil/index.json');
    const indexStat = await stat(indexPath);
    const indexData = JSON.parse(await readFile(indexPath, 'utf-8'));

    metrics.staleness.daysStale = daysSince(indexStat.mtime);

    // Count files changed since index
    if (indexData.indexed) {
      const indexDate = new Date(indexData.indexed);
      const codeFiles = await glob('**/*.{ts,tsx,js,jsx,py,rs,go,rb}', {
        cwd,
        ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**'],
        nodir: true,
      });

      for (const file of codeFiles) {
        try {
          const fileStat = await stat(join(cwd, file));
          if (fileStat.mtime > indexDate) {
            metrics.staleness.filesChangedSinceIndex++;
          }
        } catch {
          // Skip
        }
      }
    }

    metrics.staleness.needsUpdate = metrics.staleness.filesChangedSinceIndex > 5 ||
      metrics.staleness.daysStale > 7;
  } catch {
    // No index
    metrics.staleness.needsUpdate = true;
  }

  return metrics;
}

function daysSince(date: Date): number {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function formatAge(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return '1 day old';
  if (days < 7) return `${days} days old`;
  if (days < 30) return `${Math.floor(days / 7)} weeks old`;
  return `${Math.floor(days / 30)} months old`;
}
