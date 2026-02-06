/**
 * Context Builder
 *
 * Selects minimal "analysis bundle" for Oracle - not the whole repo.
 * Uses content hashing for caching and smart file selection.
 */

import { readFile, stat } from 'fs/promises';
import { createHash } from 'crypto';
import { join, relative } from 'path';
import { glob } from 'glob';
import type { RepoIndex } from './repo-indexer.js';

export interface AnalysisBundle {
  manifests: string[];      // package.json, Cargo.toml, etc.
  entrypoints: string[];    // main files by centrality
  configs: string[];        // tsconfig, lint, CI workflows
  docs: string[];           // README, ARCHITECTURE
  samples: string[];        // Representative code samples
  contentHashes: Map<string, string>;  // For caching
  totalTokenEstimate: number;
}

export interface ContextConfig {
  maxFiles: number;
  maxTotalSize: number;     // bytes
  maxTokens: number;        // estimated
  includePatterns: string[];
  excludePatterns: string[];
}

const DEFAULT_CONFIG: ContextConfig = {
  maxFiles: 50,
  maxTotalSize: 500_000,    // 500KB
  maxTokens: 100_000,       // ~100K tokens
  includePatterns: [],
  excludePatterns: [
    '**/*.min.js',
    '**/*.bundle.js',
    '**/node_modules/**',
    '**/.git/**',
    '**/dist/**',
    '**/build/**',
    '**/coverage/**',
    '**/*.lock',
    '**/package-lock.json',
    '**/yarn.lock',
    '**/pnpm-lock.yaml',
  ],
};

// Rough token estimation: ~4 chars per token
const CHARS_PER_TOKEN = 4;

/**
 * Build an analysis bundle for Oracle
 */
export async function buildAnalysisBundle(
  repoPath: string,
  index: RepoIndex,
  config: Partial<ContextConfig> = {}
): Promise<AnalysisBundle> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const bundle: AnalysisBundle = {
    manifests: [],
    entrypoints: [],
    configs: [],
    docs: [],
    samples: [],
    contentHashes: new Map(),
    totalTokenEstimate: 0,
  };

  let currentSize = 0;
  let currentTokens = 0;

  // Helper to add file if within limits
  const addFile = async (path: string, category: keyof Pick<AnalysisBundle, 'manifests' | 'entrypoints' | 'configs' | 'docs' | 'samples'>): Promise<boolean> => {
    const fullPath = join(repoPath, path);

    try {
      const stats = await stat(fullPath);
      const content = await readFile(fullPath, 'utf-8');
      const size = stats.size;
      const tokens = Math.ceil(content.length / CHARS_PER_TOKEN);

      // Check limits
      if (currentSize + size > cfg.maxTotalSize) return false;
      if (currentTokens + tokens > cfg.maxTokens) return false;
      if (bundle.manifests.length + bundle.entrypoints.length + bundle.configs.length + bundle.docs.length + bundle.samples.length >= cfg.maxFiles) {
        return false;
      }

      // Add to bundle
      bundle[category].push(path);
      bundle.contentHashes.set(path, hashContent(content));
      currentSize += size;
      currentTokens += tokens;
      bundle.totalTokenEstimate = currentTokens;

      return true;
    } catch {
      return false;
    }
  };

  // Priority 1: Manifests (always include)
  for (const manifest of index.manifests) {
    await addFile(manifest.path, 'manifests');
  }

  // Priority 2: Documentation (README, ARCHITECTURE, etc.)
  const docPriority = ['README.md', 'ARCHITECTURE.md', 'CONTRIBUTING.md', 'AGENTS.md'];
  for (const doc of docPriority) {
    const match = index.docs.find(d => d.toLowerCase() === doc.toLowerCase());
    if (match) {
      await addFile(match, 'docs');
    }
  }

  // Add other docs
  for (const doc of index.docs) {
    if (!docPriority.some(p => doc.toLowerCase() === p.toLowerCase())) {
      await addFile(doc, 'docs');
    }
  }

  // Priority 3: Config files
  const configPriority = [
    'tsconfig.json',
    '.eslintrc.json',
    '.eslintrc.js',
    'eslint.config.js',
    'vite.config.ts',
    'webpack.config.js',
    '.github/workflows/ci.yml',
    '.github/workflows/ci.yaml',
    'docker-compose.yml',
  ];

  for (const config of configPriority) {
    const match = index.configs.find(c => c.endsWith(config) || c === config);
    if (match) {
      await addFile(match, 'configs');
    }
  }

  // Priority 4: Entry points
  for (const entry of index.entrypoints) {
    await addFile(entry, 'entrypoints');
  }

  // Priority 5: Sample code files (pick representative ones)
  const samples = await selectRepresentativeSamples(repoPath, index, cfg.maxFiles - getTotalFiles(bundle));
  for (const sample of samples) {
    await addFile(sample, 'samples');
  }

  return bundle;
}

/**
 * Select representative code samples based on:
 * - File centrality (imports/exports)
 * - Naming patterns (services, controllers, models, utils)
 * - Recency (recently modified)
 */
async function selectRepresentativeSamples(
  repoPath: string,
  index: RepoIndex,
  maxCount: number
): Promise<string[]> {
  if (maxCount <= 0) return [];

  const samples: string[] = [];

  // Find key architectural files
  const architecturalPatterns = [
    '**/services/**/*.{ts,js}',
    '**/controllers/**/*.{ts,js}',
    '**/models/**/*.{ts,js}',
    '**/components/**/*.{tsx,jsx}',
    '**/hooks/**/*.{ts,tsx}',
    '**/utils/**/*.{ts,js}',
    '**/lib/**/*.{ts,js}',
    '**/api/**/*.{ts,js}',
    '**/routes/**/*.{ts,js}',
    '**/middleware/**/*.{ts,js}',
  ];

  for (const pattern of architecturalPatterns) {
    if (samples.length >= maxCount) break;

    const matches = await glob(pattern, {
      cwd: repoPath,
      ignore: DEFAULT_CONFIG.excludePatterns,
      nodir: true,
    });

    // Take up to 2 files from each pattern
    for (const match of matches.slice(0, 2)) {
      if (samples.length >= maxCount) break;
      if (!samples.includes(match)) {
        samples.push(match);
      }
    }
  }

  return samples;
}

/**
 * Hash file content for caching
 */
export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').substring(0, 16);
}

/**
 * Get bundle content hash (for cache key)
 */
export function getBundleHash(bundle: AnalysisBundle): string {
  const hashes = Array.from(bundle.contentHashes.values()).sort().join(':');
  return hashContent(hashes);
}

/**
 * Get all files in bundle as flat array
 */
export function getBundleFiles(bundle: AnalysisBundle): string[] {
  return [
    ...bundle.manifests,
    ...bundle.entrypoints,
    ...bundle.configs,
    ...bundle.docs,
    ...bundle.samples,
  ];
}

function getTotalFiles(bundle: AnalysisBundle): number {
  return bundle.manifests.length +
    bundle.entrypoints.length +
    bundle.configs.length +
    bundle.docs.length +
    bundle.samples.length;
}

/**
 * Format bundle summary for logging
 */
export function formatBundleSummary(bundle: AnalysisBundle): string {
  return `
Analysis Bundle:
  Manifests:    ${bundle.manifests.length} files
  Entrypoints:  ${bundle.entrypoints.length} files
  Configs:      ${bundle.configs.length} files
  Docs:         ${bundle.docs.length} files
  Samples:      ${bundle.samples.length} files
  ────────────────────────
  Total:        ${getTotalFiles(bundle)} files
  Est. Tokens:  ~${bundle.totalTokenEstimate.toLocaleString()}
`.trim();
}
