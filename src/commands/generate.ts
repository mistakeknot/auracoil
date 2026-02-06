/**
 * Generate Command
 *
 * Generate AGENTS.md using GPT 5.2 Pro via Oracle.
 * This is the core value proposition - GPT's superior judgment enhances docs.
 */

import { access, writeFile, readFile, mkdir } from 'fs/promises';
import { join } from 'path';
import chalk from 'chalk';
import { isOracleAvailable } from '../integrations/oracle.js';
import { indexRepository } from '../analyzer/repo-indexer.js';
import { buildAnalysisBundle, formatBundleSummary, getBundleFiles, getBundleHash } from '../analyzer/context-builder.js';
import { scanForSecrets, formatScanResults } from '../security/secret-scanner.js';
import { analyzeWithGPT, validateSections } from '../generator/gpt-analyzer.js';
import { writeAgentsMd, wouldChange } from '../generator/agents-md-writer.js';
import { writeClaudeMdPointer, isPointerClaudeMd } from '../generator/claude-md-pointer.js';

interface GenerateOptions {
  dryRun?: boolean;
  noCache?: boolean;
  apply?: boolean;  // Actually write to root (default: false, save to .auracoil/generated/)
}

export async function generateCommand(options: GenerateOptions): Promise<void> {
  const cwd = process.cwd();

  console.log(chalk.cyan('\n  Auracoil Generate\n'));

  // Step 1: Check Oracle
  console.log(chalk.dim('  Checking dependencies...'));
  const oracleAvailable = await isOracleAvailable();
  if (!oracleAvailable) {
    console.log(chalk.red('\n  ✗ Oracle CLI is required for generation'));
    console.log(chalk.dim('    Install with: npm i -g @steipete/oracle\n'));
    console.log(chalk.dim('    Auracoil uses GPT 5.2 Pro (via Oracle) to analyze'));
    console.log(chalk.dim('    your codebase and generate enhanced documentation.\n'));
    process.exit(1);
  }
  console.log(chalk.green('  ✓ Oracle CLI available'));

  // Step 2: Check initialization
  const auracoilDir = join(cwd, '.auracoil');
  try {
    await access(join(auracoilDir, 'config.yaml'));
  } catch {
    console.log(chalk.yellow('\n  ⚠ Auracoil not initialized'));
    console.log(chalk.dim('    Run `auracoil init` first\n'));
    process.exit(1);
  }

  // Step 3: Index repository
  console.log(chalk.dim('\n  Indexing repository...'));
  const index = await indexRepository(cwd);

  console.log(chalk.green(`  ✓ Found ${index.stats.totalFiles} files`));
  console.log(chalk.dim(`    Languages: ${index.languages.map(l => l.name).join(', ')}`));
  console.log(chalk.dim(`    Frameworks: ${index.frameworks.join(', ') || 'none detected'}`));

  // Step 4: Build analysis bundle
  console.log(chalk.dim('\n  Building analysis bundle...'));
  const bundle = await buildAnalysisBundle(cwd, index);

  console.log(chalk.green(`  ✓ Selected ${getBundleFiles(bundle).length} files`));
  console.log(chalk.dim(formatBundleSummary(bundle).split('\n').map(l => '    ' + l).join('\n')));

  // Step 5: Security scan
  console.log(chalk.dim('\n  Scanning for secrets...'));
  const files = getBundleFiles(bundle);
  const scanResult = await scanForSecrets(cwd, files);

  if (!scanResult.safe) {
    console.log(chalk.yellow(formatScanResults(scanResult)));

    // Remove flagged files from bundle
    const safeFiles = files.filter(f =>
      !scanResult.issues.some(i => i.file === f)
    );

    if (safeFiles.length === 0) {
      console.log(chalk.red('\n  ✗ No safe files to analyze'));
      process.exit(1);
    }

    console.log(chalk.dim(`  Proceeding with ${safeFiles.length} safe files`));
  } else {
    console.log(chalk.green('  ✓ No secrets detected'));
  }

  // Step 6: Check cache (unless --no-cache)
  if (!options.noCache) {
    const bundleHash = getBundleHash(bundle);
    const cachePath = join(auracoilDir, 'cache', `${bundleHash}.json`);

    try {
      const cached = JSON.parse(await readFile(cachePath, 'utf-8'));
      console.log(chalk.dim('\n  Using cached analysis (content unchanged)'));
      console.log(chalk.dim('  Use --no-cache to force re-analysis'));

      await finalizeOutput(cwd, cached.content, options);
      return;
    } catch {
      // No cache, continue
    }
  }

  // Step 7: Analyze with GPT
  console.log(chalk.cyan('\n  Analyzing with GPT 5.2 Pro...'));
  console.log(chalk.dim('  This may take a few minutes...\n'));

  const result = await analyzeWithGPT(cwd, index, bundle);

  if (!result.success) {
    console.log(chalk.red(`\n  ✗ Analysis failed: ${result.error}`));

    if (result.error?.includes('ECONNREFUSED')) {
      console.log(chalk.dim('\n  Troubleshooting:'));
      console.log(chalk.dim('    1. Check Xvfb: pgrep -f "Xvfb :99"'));
      console.log(chalk.dim('    2. Restart if needed: Xvfb :99 -screen 0 1920x1080x24 &'));
      console.log(chalk.dim('    3. If login expired, run oracle-login manually'));
    }

    process.exit(1);
  }

  // Step 8: Validate response
  const validation = validateSections(result.content);
  if (!validation.valid) {
    console.log(chalk.yellow(`\n  ⚠ Missing sections: ${validation.missing.join(', ')}`));
    console.log(chalk.dim('  Proceeding with partial content'));
  }

  // Step 9: Cache result
  if (!options.noCache) {
    const bundleHash = getBundleHash(bundle);
    const cachePath = join(auracoilDir, 'cache', `${bundleHash}.json`);
    await writeFile(cachePath, JSON.stringify({
      hash: bundleHash,
      timestamp: new Date().toISOString(),
      content: result.content,
    }, null, 2));
  }

  // Step 10: Write output
  await finalizeOutput(cwd, result.content, options);

  // Step 11: Update index
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

  console.log(chalk.cyan('\n  Generation complete!\n'));
}

async function finalizeOutput(
  cwd: string,
  content: string,
  options: GenerateOptions
): Promise<void> {
  const auracoilDir = join(cwd, '.auracoil');
  const generatedDir = join(auracoilDir, 'generated');

  // Always save to .auracoil/generated/ for review
  await mkdir(generatedDir, { recursive: true });
  const date = new Date().toISOString().split('T')[0];
  const draftPath = join(generatedDir, `AGENTS.${date}.md`);

  // Build the full content with header/footer
  const header = `# AGENTS.md

> Auto-generated by [Auracoil](https://github.com/anthropics/auracoil) using GPT 5.2 Pro analysis.
> Last updated: ${date}

This documentation helps AI coding assistants (Claude Code, Codex CLI) work effectively with this codebase.

---

`;

  const footer = `
---

## Contributing to This Doc

This file is generated by Auracoil. To update:
1. Run \`auracoil update\` to refresh from codebase changes
2. For custom sections, add them between \`<!-- custom:start -->\` and \`<!-- custom:end -->\` markers

<!-- custom:start -->
<!-- Add your custom content here - it will be preserved during updates -->
<!-- custom:end -->
`;

  const fullContent = header + content + footer;
  await writeFile(draftPath, fullContent);
  console.log(chalk.green(`  ✓ Saved draft to ${draftPath}`));

  // If --apply, also write to root
  if (options.apply) {
    const agentsResult = await writeAgentsMd(cwd, content, {
      dryRun: options.dryRun,
      preserveCustom: true,
    });

    // Write CLAUDE.md pointer (only if not custom)
    const isPointer = await isPointerClaudeMd(cwd);
    if (isPointer) {
      await writeClaudeMdPointer(cwd, { dryRun: options.dryRun });
    } else {
      console.log(chalk.dim('  Skipping CLAUDE.md (has custom content)'));
    }
  } else {
    console.log(chalk.cyan('\n  To apply changes to your repo:'));
    console.log(chalk.dim('    auracoil apply'));
    console.log(chalk.dim('  Or review the diff first:'));
    console.log(chalk.dim('    auracoil diff'));
  }
}
