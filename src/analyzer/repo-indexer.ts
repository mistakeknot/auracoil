/**
 * Repository Indexer
 *
 * Scans codebase to identify:
 * - Languages and frameworks
 * - Entry points and key files
 * - Dependencies
 * - Project structure
 */

import { glob } from 'glob';
import { readFile, stat } from 'fs/promises';
import { join, basename, extname } from 'path';

export interface RepoIndex {
  languages: LanguageInfo[];
  frameworks: string[];
  entrypoints: string[];
  manifests: ManifestInfo[];
  configs: string[];
  docs: string[];
  structure: DirectoryInfo;
  stats: RepoStats;
}

export interface LanguageInfo {
  name: string;
  extension: string;
  fileCount: number;
  lineCount: number;
}

export interface ManifestInfo {
  type: 'npm' | 'cargo' | 'python' | 'go' | 'ruby' | 'unknown';
  path: string;
  name?: string;
  dependencies?: string[];
}

export interface DirectoryInfo {
  path: string;
  children: DirectoryInfo[];
  hasCode: boolean;
}

export interface RepoStats {
  totalFiles: number;
  totalLines: number;
  lastModified: Date;
}

// Language detection by extension
const LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.py': 'Python',
  '.rs': 'Rust',
  '.go': 'Go',
  '.rb': 'Ruby',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.swift': 'Swift',
  '.c': 'C',
  '.cpp': 'C++',
  '.h': 'C/C++ Header',
  '.cs': 'C#',
  '.php': 'PHP',
  '.ex': 'Elixir',
  '.exs': 'Elixir',
  '.erl': 'Erlang',
  '.hs': 'Haskell',
  '.ml': 'OCaml',
  '.scala': 'Scala',
  '.clj': 'Clojure',
  '.lua': 'Lua',
  '.sh': 'Shell',
  '.zsh': 'Shell',
  '.bash': 'Shell',
};

// Framework detection patterns
const FRAMEWORK_PATTERNS: Record<string, { files?: string[]; deps?: string[] }> = {
  'Next.js': { files: ['next.config.*'], deps: ['next'] },
  'React': { deps: ['react', 'react-dom'] },
  'Vue': { deps: ['vue'] },
  'Angular': { deps: ['@angular/core'] },
  'Express': { deps: ['express'] },
  'Fastify': { deps: ['fastify'] },
  'NestJS': { deps: ['@nestjs/core'] },
  'Django': { files: ['manage.py'], deps: ['django'] },
  'Flask': { deps: ['flask'] },
  'FastAPI': { deps: ['fastapi'] },
  'Rails': { files: ['Gemfile'], deps: ['rails'] },
  'Rust/Tokio': { deps: ['tokio'] },
  'Rust/Actix': { deps: ['actix-web'] },
};

// Default excludes
const DEFAULT_EXCLUDES = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/target/**',
  '**/__pycache__/**',
  '**/venv/**',
  '**/.venv/**',
  '**/vendor/**',
  '**/*.min.js',
  '**/*.bundle.js',
  '**/coverage/**',
  '**/.next/**',
  '**/.nuxt/**',
];

/**
 * Index a repository
 */
export async function indexRepository(repoPath: string): Promise<RepoIndex> {
  const codeFiles = await glob('**/*.{ts,tsx,js,jsx,py,rs,go,rb,java,kt,swift,c,cpp,h,cs,php,ex,exs}', {
    cwd: repoPath,
    ignore: DEFAULT_EXCLUDES,
    nodir: true,
  });

  // Detect languages
  const languageCounts = new Map<string, { count: number; lines: number }>();
  for (const file of codeFiles) {
    const ext = extname(file);
    const lang = LANGUAGE_MAP[ext] || 'Unknown';
    const current = languageCounts.get(lang) || { count: 0, lines: 0 };

    // Count lines (rough estimate without reading all files)
    try {
      const content = await readFile(join(repoPath, file), 'utf-8');
      current.lines += content.split('\n').length;
    } catch {
      // Skip unreadable files
    }

    current.count++;
    languageCounts.set(lang, current);
  }

  const languages: LanguageInfo[] = Array.from(languageCounts.entries())
    .map(([name, info]) => ({
      name,
      extension: Object.entries(LANGUAGE_MAP).find(([, v]) => v === name)?.[0] || '',
      fileCount: info.count,
      lineCount: info.lines,
    }))
    .sort((a, b) => b.lineCount - a.lineCount);

  // Find manifests
  const manifests = await findManifests(repoPath);

  // Detect frameworks
  const frameworks = await detectFrameworks(repoPath, manifests);

  // Find entry points
  const entrypoints = await findEntrypoints(repoPath, languages);

  // Find config files
  const configs = await glob('**/*.{json,yaml,yml,toml,ini}', {
    cwd: repoPath,
    ignore: [...DEFAULT_EXCLUDES, '**/package-lock.json', '**/yarn.lock', '**/pnpm-lock.yaml'],
    nodir: true,
  });

  // Find documentation
  const docs = await glob('**/*.{md,mdx,txt,rst}', {
    cwd: repoPath,
    ignore: DEFAULT_EXCLUDES,
    nodir: true,
  });

  // Build structure
  const structure = await buildDirectoryStructure(repoPath);

  // Calculate stats
  const totalLines = languages.reduce((sum, l) => sum + l.lineCount, 0);

  return {
    languages,
    frameworks,
    entrypoints: entrypoints.slice(0, 10), // Top 10 entry points
    manifests,
    configs: configs.filter(c => isRelevantConfig(c)).slice(0, 20),
    docs: docs.slice(0, 20),
    structure,
    stats: {
      totalFiles: codeFiles.length,
      totalLines,
      lastModified: new Date(),
    },
  };
}

async function findManifests(repoPath: string): Promise<ManifestInfo[]> {
  const manifests: ManifestInfo[] = [];

  // Package.json (npm)
  const npmFiles = await glob('**/package.json', {
    cwd: repoPath,
    ignore: DEFAULT_EXCLUDES,
  });
  for (const file of npmFiles) {
    try {
      const content = JSON.parse(await readFile(join(repoPath, file), 'utf-8'));
      manifests.push({
        type: 'npm',
        path: file,
        name: content.name,
        dependencies: [
          ...Object.keys(content.dependencies || {}),
          ...Object.keys(content.devDependencies || {}),
        ],
      });
    } catch {
      // Skip invalid JSON
    }
  }

  // Cargo.toml (Rust)
  const cargoFiles = await glob('**/Cargo.toml', {
    cwd: repoPath,
    ignore: DEFAULT_EXCLUDES,
  });
  for (const file of cargoFiles) {
    manifests.push({ type: 'cargo', path: file });
  }

  // pyproject.toml / requirements.txt (Python)
  const pyFiles = await glob('**/{pyproject.toml,requirements.txt,setup.py}', {
    cwd: repoPath,
    ignore: DEFAULT_EXCLUDES,
  });
  for (const file of pyFiles) {
    manifests.push({ type: 'python', path: file });
  }

  // go.mod (Go)
  const goFiles = await glob('**/go.mod', {
    cwd: repoPath,
    ignore: DEFAULT_EXCLUDES,
  });
  for (const file of goFiles) {
    manifests.push({ type: 'go', path: file });
  }

  // Gemfile (Ruby)
  const rubyFiles = await glob('**/Gemfile', {
    cwd: repoPath,
    ignore: DEFAULT_EXCLUDES,
  });
  for (const file of rubyFiles) {
    manifests.push({ type: 'ruby', path: file });
  }

  return manifests;
}

async function detectFrameworks(repoPath: string, manifests: ManifestInfo[]): Promise<string[]> {
  const frameworks: Set<string> = new Set();

  // Get all npm dependencies
  const allDeps = new Set<string>();
  for (const manifest of manifests.filter(m => m.type === 'npm')) {
    manifest.dependencies?.forEach(d => allDeps.add(d));
  }

  // Check each framework pattern
  for (const [framework, pattern] of Object.entries(FRAMEWORK_PATTERNS)) {
    // Check file patterns
    if (pattern.files) {
      for (const filePattern of pattern.files) {
        const matches = await glob(filePattern, { cwd: repoPath, ignore: DEFAULT_EXCLUDES });
        if (matches.length > 0) {
          frameworks.add(framework);
          break;
        }
      }
    }

    // Check dependencies
    if (pattern.deps) {
      for (const dep of pattern.deps) {
        if (allDeps.has(dep)) {
          frameworks.add(framework);
          break;
        }
      }
    }
  }

  return Array.from(frameworks);
}

async function findEntrypoints(repoPath: string, languages: LanguageInfo[]): Promise<string[]> {
  const entrypoints: string[] = [];

  // Common entry point patterns
  const patterns = [
    'src/index.{ts,tsx,js,jsx}',
    'src/main.{ts,tsx,js,jsx,py,rs,go}',
    'src/app.{ts,tsx,js,jsx,py}',
    'index.{ts,tsx,js,jsx}',
    'main.{ts,tsx,js,jsx,py,rs,go}',
    'app.{ts,tsx,js,jsx,py}',
    'lib/index.{ts,tsx,js,jsx}',
    'pages/index.{ts,tsx,js,jsx}',
    'app/page.{ts,tsx,js,jsx}',
    'src/lib.rs',
    'cmd/*/main.go',
  ];

  for (const pattern of patterns) {
    const matches = await glob(pattern, { cwd: repoPath, ignore: DEFAULT_EXCLUDES });
    entrypoints.push(...matches);
  }

  return [...new Set(entrypoints)];
}

async function buildDirectoryStructure(repoPath: string, depth: number = 3): Promise<DirectoryInfo> {
  const allDirs = await glob('**/', {
    cwd: repoPath,
    ignore: DEFAULT_EXCLUDES,
    maxDepth: depth,
  });

  // Build tree structure (simplified for now)
  return {
    path: '.',
    children: [],
    hasCode: true,
  };
}

function isRelevantConfig(path: string): boolean {
  const relevantNames = [
    'tsconfig',
    'eslint',
    'prettier',
    '.env.example',
    'jest.config',
    'vitest.config',
    'webpack.config',
    'vite.config',
    'rollup.config',
    'babel.config',
    'tailwind.config',
    'postcss.config',
    'docker-compose',
    'Dockerfile',
    '.github/workflows',
  ];

  return relevantNames.some(name => path.toLowerCase().includes(name.toLowerCase()));
}
