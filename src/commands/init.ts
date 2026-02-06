/**
 * Init Command
 *
 * Initialize Auracoil config with safe defaults.
 */

import { mkdir, writeFile, access, readFile } from 'fs/promises';
import { join } from 'path';
import chalk from 'chalk';
import yaml from 'js-yaml';
import { isOracleAvailable, getOracleVersion } from '../integrations/oracle.js';

interface InitOptions {
  force?: boolean;
}

const DEFAULT_CONFIG = {
  version: '1.0',

  // Analysis settings
  analysis: {
    maxFiles: 50,
    maxTotalSize: 500000,  // 500KB
    maxTokens: 100000,     // ~100K tokens
  },

  // Exclude patterns (sensitive by default)
  exclude: [
    '**/node_modules/**',
    '**/.git/**',
    '**/dist/**',
    '**/build/**',
    '**/target/**',
    '**/__pycache__/**',
    '**/venv/**',
    '**/.venv/**',
    '**/vendor/**',
    '**/coverage/**',
    '**/.next/**',
    '**/.nuxt/**',
    '**/*.min.js',
    '**/*.bundle.js',
    '**/package-lock.json',
    '**/yarn.lock',
    '**/pnpm-lock.yaml',
    // Sensitive files
    '**/.env*',
    '**/credentials*',
    '**/secrets*',
    '**/*.pem',
    '**/*.key',
  ],

  // Include patterns (override excludes)
  include: [
    '.env.example',
    '.env.template',
  ],

  // Oracle settings
  oracle: {
    model: 'gpt-5.2-pro',
    timeout: 600000,  // 10 minutes
  },

  // Generation settings
  generate: {
    outputStability: true,  // Minimize diffs
    sectionMarkers: true,   // Add <!-- auracoil:section:* --> markers
  },
};

const GITIGNORE_ENTRIES = `
# Auracoil
.auracoil/cache/
.auracoil/oracle/
`;

export async function initCommand(options: InitOptions): Promise<void> {
  const cwd = process.cwd();
  const auracoilDir = join(cwd, '.auracoil');

  console.log(chalk.cyan('\n  Initializing Auracoil...\n'));

  // Check Oracle availability
  const oracleAvailable = await isOracleAvailable();
  if (!oracleAvailable) {
    console.log(chalk.yellow('  ⚠ Oracle CLI not found'));
    console.log(chalk.dim('    Install with: npm i -g @steipete/oracle'));
    console.log(chalk.dim('    Oracle is required for generate/update commands\n'));
  } else {
    const version = await getOracleVersion();
    console.log(chalk.green(`  ✓ Oracle CLI found (${version})`));
  }

  // Check if already initialized
  try {
    await access(join(auracoilDir, 'config.yaml'));
    if (!options.force) {
      console.log(chalk.yellow('\n  Auracoil already initialized.'));
      console.log(chalk.dim('  Use --force to reinitialize.\n'));
      return;
    }
    console.log(chalk.dim('  Reinitializing (--force)...\n'));
  } catch {
    // Not initialized, continue
  }

  // Create directory structure
  await mkdir(auracoilDir, { recursive: true });
  await mkdir(join(auracoilDir, 'cache'), { recursive: true });
  await mkdir(join(auracoilDir, 'oracle'), { recursive: true });
  await mkdir(join(auracoilDir, 'solutions'), { recursive: true });

  // Write config
  const configPath = join(auracoilDir, 'config.yaml');
  const configYaml = yaml.dump(DEFAULT_CONFIG, {
    indent: 2,
    lineWidth: 100,
    noRefs: true,
  });

  await writeFile(configPath, `# Auracoil Configuration
# Documentation: https://github.com/your-org/auracoil

${configYaml}`);

  console.log(chalk.green('  ✓ Created .auracoil/config.yaml'));

  // Create empty index
  await writeFile(
    join(auracoilDir, 'index.json'),
    JSON.stringify({ version: '1.0', indexed: null, languages: [], frameworks: [] }, null, 2)
  );
  console.log(chalk.green('  ✓ Created .auracoil/index.json'));

  // Update .gitignore
  const gitignorePath = join(cwd, '.gitignore');
  try {
    const existing = await readFile(gitignorePath, 'utf-8');
    if (!existing.includes('.auracoil/cache/')) {
      await writeFile(gitignorePath, existing + GITIGNORE_ENTRIES);
      console.log(chalk.green('  ✓ Updated .gitignore'));
    }
  } catch {
    // No .gitignore, create one
    await writeFile(gitignorePath, GITIGNORE_ENTRIES.trim() + '\n');
    console.log(chalk.green('  ✓ Created .gitignore'));
  }

  console.log(chalk.cyan('\n  Auracoil initialized successfully!\n'));
  console.log(chalk.dim('  Next steps:'));
  console.log(chalk.dim('    1. Review .auracoil/config.yaml'));
  console.log(chalk.dim('    2. Run `auracoil generate` to create AGENTS.md\n'));
}
