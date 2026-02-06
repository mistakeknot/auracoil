/**
 * Update Command
 *
 * Incremental update - GPT re-analyzes only changed areas.
 */

import { access, readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import chalk from 'chalk';
import { simpleGit } from 'simple-git';
import { isOracleAvailable } from '../integrations/oracle.js';
import { indexRepository } from '../analyzer/repo-indexer.js';
import { buildAnalysisBundle, getBundleFiles, getBundleHash } from '../analyzer/context-builder.js';
import { scanForSecrets } from '../security/secret-scanner.js';
import { analyzeWithGPT, extractSection, replaceSection } from '../generator/gpt-analyzer.js';
import { writeAgentsMd, wouldChange } from '../generator/agents-md-writer.js';

interface UpdateOptions {
  force?: boolean;
}

export async function updateCommand(options: UpdateOptions): Promise<void> {
  const cwd = process.cwd();
  const git = simpleGit(cwd);

  console.log(chalk.cyan('\n  Auracoil Update\n'));

  // Check Oracle
  if (!(await isOracleAvailable())) {
    console.log(chalk.red('  ✗ Oracle CLI required'));
    process.exit(1);
  }

  // Check initialization
  const auracoilDir = join(cwd, '.auracoil');
  try {
    await access(join(auracoilDir, 'config.yaml'));
  } catch {
    console.log(chalk.yellow('  ⚠ Not initialized. Run `auracoil init` first\n'));
    process.exit(1);
  }

  // Check existing AGENTS.md
  const agentsPath = join(cwd, 'AGENTS.md');
  let existingContent: string;
  try {
    existingContent = await readFile(agentsPath, 'utf-8');
  } catch {
    console.log(chalk.yellow('  ⚠ No AGENTS.md found'));
    console.log(chalk.dim('    Run `auracoil generate` first\n'));
    process.exit(1);
  }

  // Get changed files since last index
  let changedFiles: string[] = [];

  if (!options.force) {
    try {
      const indexData = JSON.parse(await readFile(join(auracoilDir, 'index.json'), 'utf-8'));
      const lastIndexed = indexData.indexed;

      if (lastIndexed) {
        // Get files changed since last index
        const diffResult = await git.diffSummary([`--since="${lastIndexed}"`]);
        changedFiles = diffResult.files.map((f: { file: string }) => f.file);

        console.log(chalk.dim(`  ${changedFiles.length} files changed since last index`));

        if (changedFiles.length === 0) {
          console.log(chalk.green('\n  ✓ Documentation is up to date\n'));
          return;
        }
      }
    } catch {
      // Fall back to full update
      console.log(chalk.dim('  No index found, doing full update'));
      options.force = true;
    }
  }

  if (options.force) {
    console.log(chalk.dim('  Force update: regenerating all sections'));
  }

  // Index and build bundle
  console.log(chalk.dim('\n  Indexing repository...'));
  const index = await indexRepository(cwd);
  const bundle = await buildAnalysisBundle(cwd, index);

  // Security scan
  const files = getBundleFiles(bundle);
  const scanResult = await scanForSecrets(cwd, files);
  if (!scanResult.safe) {
    console.log(chalk.yellow('  ⚠ Some files excluded for security'));
  }

  // Determine which sections to update
  const sectionsToUpdate = options.force
    ? ['overview', 'quickstart', 'architecture', 'conventions', 'gotchas', 'patterns', 'testing', 'deployment']
    : determineSectionsToUpdate(changedFiles);

  console.log(chalk.dim(`\n  Updating sections: ${sectionsToUpdate.join(', ')}`));

  // Analyze with GPT
  console.log(chalk.cyan('\n  Querying GPT 5.2 Pro...'));

  const result = await analyzeWithGPT(cwd, index, bundle);

  if (!result.success) {
    console.log(chalk.red(`\n  ✗ Analysis failed: ${result.error}`));
    process.exit(1);
  }

  // Merge new content with existing
  let updatedContent = existingContent;
  let sectionsUpdated = 0;

  for (const section of sectionsToUpdate) {
    const newSection = extractSection(result.content, section);
    if (newSection) {
      updatedContent = replaceSection(updatedContent, section, newSection);
      sectionsUpdated++;
    }
  }

  // Check if anything changed
  if (!(await wouldChange(cwd, updatedContent))) {
    console.log(chalk.green('\n  ✓ No changes needed\n'));
    return;
  }

  // Write updated content
  await writeAgentsMd(cwd, result.content, {
    preserveCustom: true,
  });

  // Update index
  await writeFile(
    join(auracoilDir, 'index.json'),
    JSON.stringify({
      version: '1.0',
      indexed: new Date().toISOString(),
      languages: index.languages,
      frameworks: index.frameworks,
      stats: index.stats,
    }, null, 2)
  );

  console.log(chalk.cyan(`\n  ✓ Updated ${sectionsUpdated} sections\n`));
}

/**
 * Determine which sections need updating based on changed files
 */
function determineSectionsToUpdate(changedFiles: string[]): string[] {
  const sections = new Set<string>();

  for (const file of changedFiles) {
    const lower = file.toLowerCase();

    // Architecture changes
    if (lower.includes('src/') || lower.includes('lib/') ||
        lower.endsWith('index.ts') || lower.endsWith('index.js')) {
      sections.add('architecture');
    }

    // Config changes
    if (lower.includes('config') || lower.includes('tsconfig') ||
        lower.includes('eslint') || lower.includes('prettier')) {
      sections.add('conventions');
    }

    // Test changes
    if (lower.includes('test') || lower.includes('spec') ||
        lower.includes('__tests__')) {
      sections.add('testing');
    }

    // Deployment changes
    if (lower.includes('docker') || lower.includes('deploy') ||
        lower.includes('.github/workflows') || lower.includes('vercel')) {
      sections.add('deployment');
    }

    // Package changes
    if (lower.includes('package.json') || lower.includes('cargo.toml') ||
        lower.includes('requirements.txt') || lower.includes('gemfile')) {
      sections.add('quickstart');
      sections.add('overview');
    }
  }

  // Always include gotchas (might be affected by any change)
  sections.add('gotchas');

  return Array.from(sections);
}
