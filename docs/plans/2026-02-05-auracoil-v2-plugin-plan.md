# Auracoil v2: Claude Code Plugin Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform Auracoil from a standalone CLI doc generator into a Claude Code plugin that accretively enhances AGENTS.md using GPT 5.2 Pro as a reviewer/critic.

**Architecture:** Author–Critic–Applier pattern. Claude (author) gathers evidence and drafts a candidate. GPT 5.2 Pro (critic) reviews existing docs + evidence and returns structured suggestions. A deterministic tool (applier) patches only the Auracoil-owned region of AGENTS.md. State is persisted in `.auracoil/state.json` so each run builds on the last.

**Tech Stack:** TypeScript/Node.js CLI backend, Claude Code plugin (skill + command), Oracle CLI for GPT access, vitest for tests.

**Key Design Sources:**
- Critical evaluation: `docs/oracle-architecture-review-2026-02-05.md`
- Plugin structure reference: `~/.claude/plugins/cache/superpowers-marketplace/superpowers-developing-for-claude-code/0.3.1/skills/developing-claude-code-plugins/references/plugin-structure.md`
- Interdoc plugin (analog): `~/.claude/plugins/cache/interagency-marketplace/interdoc/4.5.0/`

---

## What Changes

### Keep (working, valuable)
- `src/analyzer/repo-indexer.ts` — language/framework detection
- `src/analyzer/context-builder.ts` — smart file selection with token budgets
- `src/security/secret-scanner.ts` — secret scanning before Oracle upload
- `src/integrations/oracle.ts` — Oracle subprocess wrapper (with fixes)
- `src/commands/health.ts` — staleness reporting
- `src/commands/diff.ts` — diff display
- `src/commands/apply.ts` — file application
- All tests

### Cut
- `src/commands/capture.ts` — out of scope (knowledge capture is a separate tool)
- `src/commands/search.ts` — out of scope
- `src/commands/init.ts` — replaced by plugin installation; `.auracoil/` created on first run
- `src/commands/update.ts` — broken (invalid git syntax, section markers GPT doesn't produce); replaced by `review` command
- `src/generator/agents-md-writer.ts` — replaced by region-aware writer
- `src/generator/claude-md-pointer.ts` — Auracoil should not touch CLAUDE.md

### Create New
- `src/commands/review.ts` — core command: GPT reviews existing AGENTS.md
- `src/prompts/review-prompt.ts` — critic prompt (existing docs + evidence → suggestions)
- `src/state/state-manager.ts` — persistent state (`.auracoil/state.json`)
- `src/regions/region-parser.ts` — parse/write Auracoil-owned regions in AGENTS.md
- Plugin files: `.claude-plugin/plugin.json`, `skills/auracoil/SKILL.md`, `commands/auracoil.md`

### Modify
- `src/index.ts` — remove cut commands, add `review`
- `src/integrations/oracle.ts` — add pre-flight check
- `src/prompts/analysis-prompt.ts` — rewrite for critic role (not generator)

---

## Task 1: Add Oracle Pre-Flight Check

The most common failure mode: Oracle session is expired but we don't know until after minutes of indexing. Fix this first.

**Files:**
- Modify: `src/integrations/oracle.ts`
- Test: `src/integrations/oracle.test.ts`

**Step 1: Write the failing test**

Add to `src/integrations/oracle.test.ts`:

```typescript
describe('checkOracleSession', () => {
  it('should return a health status object', async () => {
    const status = await checkOracleSession();
    expect(status).toHaveProperty('available');
    expect(status).toHaveProperty('message');
    expect(typeof status.available).toBe('boolean');
    expect(typeof status.message).toBe('string');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/integrations/oracle.test.ts`
Expected: FAIL — `checkOracleSession` is not exported

**Step 3: Implement checkOracleSession**

Add to `src/integrations/oracle.ts`:

```typescript
export interface OracleHealth {
  available: boolean;
  message: string;
}

/**
 * Pre-flight check: can Oracle actually reach GPT?
 * Sends a tiny prompt to verify the session is alive.
 */
export async function checkOracleSession(): Promise<OracleHealth> {
  if (!(await isOracleAvailable())) {
    return { available: false, message: 'Oracle CLI not installed' };
  }

  try {
    const result = await executeOracle({
      prompt: 'Reply with only the word READY',
      timeout: 30000, // 30s is enough for a health check
    });

    if (result.success && result.output.includes('READY')) {
      return { available: true, message: 'Oracle session active' };
    }

    if (result.error?.includes('ECONNREFUSED')) {
      return { available: false, message: 'Chrome not running — restart X11 stack or run oracle-login' };
    }

    return { available: false, message: result.error || 'Oracle returned unexpected output' };
  } catch {
    return { available: false, message: 'Oracle pre-flight failed' };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/integrations/oracle.test.ts`
Expected: PASS (test checks structure, not Oracle availability)

**Step 5: Build and verify types**

Run: `npm run build`
Expected: No errors

**Step 6: Commit**

```bash
git add src/integrations/oracle.ts src/integrations/oracle.test.ts
git commit -m "feat: add Oracle pre-flight session check"
```

---

## Task 2: Create State Manager

Persistent state enables accretive behavior — knowing what was reviewed, when, and what findings are still open.

**Files:**
- Create: `src/state/state-manager.ts`
- Create: `src/state/state-manager.test.ts`

**Step 1: Write the failing test**

Create `src/state/state-manager.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { StateManager } from './state-manager.js';

describe('StateManager', () => {
  let tempDir: string;
  let state: StateManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'auracoil-test-'));
    state = new StateManager(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it('should initialize with empty state', async () => {
    const data = await state.load();
    expect(data.lastReviewedCommit).toBeNull();
    expect(data.findings).toEqual([]);
  });

  it('should persist and reload state', async () => {
    await state.update({
      lastReviewedCommit: 'abc123',
      lastReviewedAt: '2026-02-05T00:00:00Z',
      agentsMdHash: 'hash123',
    });
    const reloaded = new StateManager(tempDir);
    const data = await reloaded.load();
    expect(data.lastReviewedCommit).toBe('abc123');
  });

  it('should add and track findings', async () => {
    await state.addFinding({
      id: 'missing-test-cmd',
      severity: 'medium',
      section: 'Quick Start',
      suggestion: 'Add test command: npm test',
      evidence: 'package.json has test script but AGENTS.md omits it',
    });
    const data = await state.load();
    expect(data.findings).toHaveLength(1);
    expect(data.findings[0].status).toBe('open');
  });

  it('should resolve findings', async () => {
    await state.addFinding({
      id: 'missing-test-cmd',
      severity: 'medium',
      section: 'Quick Start',
      suggestion: 'Add test command',
      evidence: 'missing',
    });
    await state.resolveFinding('missing-test-cmd');
    const data = await state.load();
    expect(data.findings[0].status).toBe('resolved');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/state/state-manager.test.ts`
Expected: FAIL — module not found

**Step 3: Implement StateManager**

Create `src/state/state-manager.ts`:

```typescript
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

export interface Finding {
  id: string;
  severity: 'low' | 'medium' | 'high';
  section: string;
  suggestion: string;
  evidence: string;
  status: 'open' | 'resolved';
  introducedAt: string;
  resolvedAt?: string;
}

export interface AuracoilState {
  lastReviewedCommit: string | null;
  lastReviewedAt: string | null;
  agentsMdHash: string | null;
  findings: Finding[];
}

const EMPTY_STATE: AuracoilState = {
  lastReviewedCommit: null,
  lastReviewedAt: null,
  agentsMdHash: null,
  findings: [],
};

export class StateManager {
  private statePath: string;

  constructor(repoRoot: string) {
    this.statePath = join(repoRoot, '.auracoil', 'state.json');
  }

  async load(): Promise<AuracoilState> {
    try {
      const raw = await readFile(this.statePath, 'utf-8');
      return { ...EMPTY_STATE, ...JSON.parse(raw) };
    } catch {
      return { ...EMPTY_STATE };
    }
  }

  async update(partial: Partial<AuracoilState>): Promise<void> {
    const current = await this.load();
    const updated = { ...current, ...partial };
    await mkdir(join(this.statePath, '..'), { recursive: true });
    await writeFile(this.statePath, JSON.stringify(updated, null, 2));
  }

  async addFinding(finding: Omit<Finding, 'status' | 'introducedAt'>): Promise<void> {
    const current = await this.load();
    // Don't add duplicate IDs
    if (current.findings.some(f => f.id === finding.id)) return;
    current.findings.push({
      ...finding,
      status: 'open',
      introducedAt: new Date().toISOString(),
    });
    await this.save(current);
  }

  async resolveFinding(id: string): Promise<void> {
    const current = await this.load();
    const finding = current.findings.find(f => f.id === id);
    if (finding) {
      finding.status = 'resolved';
      finding.resolvedAt = new Date().toISOString();
      await this.save(current);
    }
  }

  private async save(state: AuracoilState): Promise<void> {
    await mkdir(join(this.statePath, '..'), { recursive: true });
    await writeFile(this.statePath, JSON.stringify(state, null, 2));
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/state/state-manager.test.ts`
Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add src/state/state-manager.ts src/state/state-manager.test.ts
git commit -m "feat: add persistent state manager for accretive tracking"
```

---

## Task 3: Create Region Parser

Auracoil owns a fenced region in AGENTS.md. This parser reads/writes only that region, leaving everything else untouched. This is how Auracoil and Interdoc coexist.

**Files:**
- Create: `src/regions/region-parser.ts`
- Create: `src/regions/region-parser.test.ts`

**Step 1: Write the failing test**

Create `src/regions/region-parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { extractRegion, replaceRegion, ensureRegion } from './region-parser.js';

const SAMPLE_DOC = `# AGENTS.md

## Overview
Project overview here.

<!-- auracoil:begin -->
## GPT Insights (maintained by Auracoil)

Some existing insights.
<!-- auracoil:end -->

## Architecture
Architecture section.
`;

describe('extractRegion', () => {
  it('should extract content between markers', () => {
    const content = extractRegion(SAMPLE_DOC);
    expect(content).toContain('GPT Insights');
    expect(content).toContain('Some existing insights');
    expect(content).not.toContain('Overview');
  });

  it('should return null when no markers exist', () => {
    expect(extractRegion('# Just a doc')).toBeNull();
  });
});

describe('replaceRegion', () => {
  it('should replace content between markers', () => {
    const result = replaceRegion(SAMPLE_DOC, '## New Insights\n\nBetter content.');
    expect(result).toContain('New Insights');
    expect(result).toContain('Better content');
    expect(result).toContain('Overview');
    expect(result).toContain('Architecture');
    expect(result).not.toContain('Some existing insights');
  });
});

describe('ensureRegion', () => {
  it('should add markers to doc without them', () => {
    const doc = '# AGENTS.md\n\n## Overview\nStuff.\n';
    const result = ensureRegion(doc);
    expect(result).toContain('<!-- auracoil:begin -->');
    expect(result).toContain('<!-- auracoil:end -->');
    expect(result).toContain('## Overview');
  });

  it('should not duplicate markers if already present', () => {
    const result = ensureRegion(SAMPLE_DOC);
    const beginCount = (result.match(/auracoil:begin/g) || []).length;
    expect(beginCount).toBe(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/regions/region-parser.test.ts`
Expected: FAIL — module not found

**Step 3: Implement region parser**

Create `src/regions/region-parser.ts`:

```typescript
const BEGIN_MARKER = '<!-- auracoil:begin -->';
const END_MARKER = '<!-- auracoil:end -->';

const DEFAULT_REGION = `${BEGIN_MARKER}
## GPT Insights (maintained by Auracoil)

_No reviews yet. Run \`/auracoil\` to get GPT 5.2 Pro's analysis._
${END_MARKER}`;

/**
 * Extract the Auracoil-owned region content (between markers).
 * Returns null if markers are not present.
 */
export function extractRegion(doc: string): string | null {
  const beginIdx = doc.indexOf(BEGIN_MARKER);
  const endIdx = doc.indexOf(END_MARKER);
  if (beginIdx === -1 || endIdx === -1) return null;
  return doc.substring(beginIdx + BEGIN_MARKER.length, endIdx).trim();
}

/**
 * Replace the Auracoil-owned region with new content.
 * Preserves everything outside the markers.
 */
export function replaceRegion(doc: string, newContent: string): string {
  const beginIdx = doc.indexOf(BEGIN_MARKER);
  const endIdx = doc.indexOf(END_MARKER);
  if (beginIdx === -1 || endIdx === -1) {
    throw new Error('Auracoil region markers not found in document');
  }
  const before = doc.substring(0, beginIdx + BEGIN_MARKER.length);
  const after = doc.substring(endIdx);
  return `${before}\n${newContent.trim()}\n${after}`;
}

/**
 * Ensure the Auracoil region exists in the document.
 * Appends it at the end if not present.
 */
export function ensureRegion(doc: string): string {
  if (doc.includes(BEGIN_MARKER)) return doc;
  return `${doc.trimEnd()}\n\n${DEFAULT_REGION}\n`;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/regions/region-parser.test.ts`
Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add src/regions/region-parser.ts src/regions/region-parser.test.ts
git commit -m "feat: add region parser for Auracoil-owned AGENTS.md sections"
```

---

## Task 4: Rewrite the GPT Prompt for Critic Role

The current prompt asks GPT to "generate AGENTS.md." The new prompt asks GPT to "review this existing AGENTS.md and suggest improvements." This is the core of the accretive model.

**Files:**
- Modify: `src/prompts/analysis-prompt.ts` → rename to `src/prompts/review-prompt.ts`
- Test: `src/prompts/review-prompt.test.ts`

**Step 1: Write the failing test**

Create `src/prompts/review-prompt.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildReviewPrompt } from './review-prompt.js';

describe('buildReviewPrompt', () => {
  it('should include the existing AGENTS.md content', () => {
    const prompt = buildReviewPrompt({
      existingAgentsMd: '## Overview\nA web app.',
      changedFiles: ['src/auth.ts'],
      commitMessages: ['Add JWT auth'],
      repoName: 'myapp',
      languages: ['TypeScript'],
    });
    expect(prompt).toContain('## Overview');
    expect(prompt).toContain('A web app');
  });

  it('should include changed files as evidence', () => {
    const prompt = buildReviewPrompt({
      existingAgentsMd: '## Overview\nStuff.',
      changedFiles: ['src/auth.ts', 'src/db.ts'],
      commitMessages: ['Add auth', 'Add DB layer'],
      repoName: 'myapp',
      languages: ['TypeScript'],
    });
    expect(prompt).toContain('src/auth.ts');
    expect(prompt).toContain('Add auth');
  });

  it('should request structured JSON suggestions output', () => {
    const prompt = buildReviewPrompt({
      existingAgentsMd: 'doc',
      changedFiles: [],
      commitMessages: [],
      repoName: 'test',
      languages: ['Go'],
    });
    expect(prompt).toContain('JSON');
    expect(prompt).toContain('suggestions');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/prompts/review-prompt.test.ts`
Expected: FAIL — module not found

**Step 3: Implement review prompt**

Create `src/prompts/review-prompt.ts`:

```typescript
export interface ReviewPromptInput {
  existingAgentsMd: string;
  changedFiles: string[];
  commitMessages: string[];
  repoName: string;
  languages: string[];
}

/**
 * Build the prompt that makes GPT a reviewer/critic, not a generator.
 *
 * Key constraints:
 * - Oracle has no --system flag in browser mode; system prompt is built-in.
 * - Oracle is one-shot; all context must be in the prompt.
 * - Keep under ~4000 chars of prompt text (files are attached separately via -f).
 */
export function buildReviewPrompt(input: ReviewPromptInput): string {
  const { existingAgentsMd, changedFiles, commitMessages, repoName, languages } = input;

  const evidenceSection = changedFiles.length > 0
    ? `## Evidence: Recent Changes

**Changed files (${changedFiles.length}):**
${changedFiles.slice(0, 30).map(f => `- ${f}`).join('\n')}

**Recent commits:**
${commitMessages.slice(0, 15).map(m => `- ${m}`).join('\n')}`
    : '## Evidence: No recent changes (first review)';

  return `You are reviewing AGENTS.md documentation for the ${languages.join('/')} project "${repoName}".

Your role: CRITIC. Review the existing documentation for accuracy, completeness, and usefulness to AI coding agents. Do NOT rewrite the document. Suggest specific, targeted improvements.

## Current AGENTS.md (Auracoil region only)

${existingAgentsMd}

${evidenceSection}

## Your Task

Review the documentation against the attached source files. Return a JSON array of suggestions:

\`\`\`json
{
  "suggestions": [
    {
      "id": "short-kebab-id",
      "severity": "low|medium|high",
      "section": "which section this affects",
      "type": "add|correct|flag-stale",
      "suggestion": "what to change (be specific, include exact text)",
      "evidence": "why — cite file paths or commit messages"
    }
  ],
  "summary": "1-2 sentence overall assessment"
}
\`\`\`

Rules:
- Only suggest changes backed by evidence from the source files or git history
- "add" = new content missing from docs. "correct" = existing content is wrong. "flag-stale" = content may be outdated.
- For "add" suggestions, include the exact markdown to insert
- Limit to 10 most important suggestions
- If documentation is accurate and complete, return an empty suggestions array`;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/prompts/review-prompt.test.ts`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add src/prompts/review-prompt.ts src/prompts/review-prompt.test.ts
git commit -m "feat: add critic-role review prompt for GPT"
```

---

## Task 5: Create the `review` Command

This replaces both `generate` and `update`. It's the single core command: gather evidence, send to GPT for review, save structured suggestions.

**Files:**
- Create: `src/commands/review.ts`

**Step 1: Implement the review command**

Create `src/commands/review.ts`:

```typescript
import { readFile, writeFile, mkdir, access } from 'fs/promises';
import { join } from 'path';
import chalk from 'chalk';
import { simpleGit } from 'simple-git';
import { checkOracleSession, executeOracle } from '../integrations/oracle.js';
import { indexRepository } from '../analyzer/repo-indexer.js';
import { buildAnalysisBundle, getBundleFiles } from '../analyzer/context-builder.js';
import { scanForSecrets } from '../security/secret-scanner.js';
import { buildReviewPrompt } from '../prompts/review-prompt.js';
import { extractRegion, ensureRegion } from '../regions/region-parser.js';
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
      console.log(chalk.red(`\n  ✗ ${health.message}`));
      console.log(chalk.dim('    Fix Oracle, then retry. Use --skip-preflight to bypass.\n'));
      process.exit(1);
    }
    console.log(chalk.green('  ✓ Oracle session active'));
  }

  // Step 2: Read existing AGENTS.md
  const agentsPath = join(cwd, 'AGENTS.md');
  let agentsMd: string;
  try {
    agentsMd = await readFile(agentsPath, 'utf-8');
  } catch {
    console.log(chalk.yellow('  No AGENTS.md found — run /interdoc or create one first.\n'));
    process.exit(1);
  }

  // Step 3: Extract Auracoil region (or note it's missing)
  const existingRegion = extractRegion(agentsMd);
  const regionContent = existingRegion || '(No Auracoil region yet — first review)';

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
    console.log(chalk.red(`\n  ✗ Review failed: ${result.error}\n`));
    process.exit(1);
  }

  // Step 9: Save raw review output
  const reviewDir = join(cwd, '.auracoil', 'reviews');
  await mkdir(reviewDir, { recursive: true });
  const date = new Date().toISOString().split('T')[0];
  const reviewPath = join(reviewDir, `review-${date}.json`);
  await writeFile(reviewPath, result.output);
  console.log(chalk.green(`  ✓ Review saved to ${reviewPath}`));

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
```

**Step 2: Build and verify types**

Run: `npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/commands/review.ts
git commit -m "feat: add review command — GPT as critic, not generator"
```

---

## Task 6: Update CLI Entry Point

Remove cut commands, add `review`, keep `health`/`diff`/`apply`.

**Files:**
- Modify: `src/index.ts`

**Step 1: Rewrite index.ts**

Replace `src/index.ts` with:

```typescript
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
```

**Step 2: Build**

Run: `npm run build`
Expected: May have errors from removed imports — that's OK, we fix in next step

**Step 3: Delete cut command files**

```bash
rm src/commands/init.ts src/commands/capture.ts src/commands/search.ts src/commands/update.ts
rm src/commands/generate.ts
rm src/generator/agents-md-writer.ts src/generator/claude-md-pointer.ts
rm src/prompts/analysis-prompt.ts
```

**Step 4: Update remaining commands that import removed modules**

Modify `src/commands/health.ts` — remove any imports of deleted modules. Modify `src/commands/apply.ts` — replace `writeAgentsMd` with region-aware writing. Modify `src/commands/diff.ts` — update to work with review files instead of generated files.

(These are straightforward import fixes — the implementations stay mostly the same, just reading from `.auracoil/reviews/` instead of `.auracoil/generated/`.)

**Step 5: Build and verify**

Run: `npm run build`
Expected: No errors

**Step 6: Verify CLI**

Run: `node dist/index.js --help`
Expected: Shows `review`, `health`, `diff`, `apply` commands

**Step 7: Commit**

```bash
git add -A
git commit -m "refactor: slim CLI to review/health/diff/apply — cut generate/init/capture/search"
```

---

## Task 7: Create the Claude Code Plugin Structure

This is the plugin packaging — skill, command, plugin.json.

**Files:**
- Create: `.claude-plugin/plugin.json`
- Create: `.claude-plugin/marketplace.json`
- Create: `skills/auracoil/SKILL.md`
- Create: `commands/auracoil.md`

**Step 1: Create plugin.json**

Create `.claude-plugin/plugin.json`:

```json
{
  "name": "auracoil",
  "version": "0.2.0",
  "description": "GPT 5.2 Pro reviewer for AGENTS.md — accretive cross-AI documentation enhancement via Oracle",
  "author": {
    "name": "MK"
  },
  "homepage": "https://github.com/anthropics/auracoil",
  "license": "MIT"
}
```

**Step 2: Create dev marketplace**

Create `.claude-plugin/marketplace.json`:

```json
{
  "name": "auracoil-dev",
  "description": "Development marketplace for Auracoil",
  "owner": {
    "name": "MK"
  },
  "plugins": [
    {
      "name": "auracoil",
      "description": "GPT 5.2 Pro reviewer for AGENTS.md",
      "version": "0.2.0",
      "source": "./"
    }
  ]
}
```

**Step 3: Create the slash command**

Create `commands/auracoil.md`:

```markdown
---
description: Run Auracoil to get GPT 5.2 Pro's review of this project's AGENTS.md
---

# /auracoil

Run the Auracoil skill to review and enhance AGENTS.md using GPT 5.2 Pro via Oracle.

This command should:
- Check if AGENTS.md exists (suggest running /interdoc first if not)
- Ensure the Auracoil region exists in AGENTS.md
- Run `auracoil review` to get GPT's suggestions
- Present suggestions to the user for approval
- Apply approved changes to the Auracoil region only
```

**Step 4: Create the SKILL.md**

Create `skills/auracoil/SKILL.md`:

```markdown
---
name: auracoil
description: Enhance AGENTS.md with GPT 5.2 Pro review via Oracle. Use when asked to "review docs with GPT", "enhance AGENTS.md", "cross-AI review", "auracoil", or after significant project changes.
---

# Auracoil: Cross-AI Documentation Reviewer

## Purpose

Use GPT 5.2 Pro (via Oracle) to review and accretively enhance AGENTS.md documentation. Auracoil is a **critic**, not a generator — it reviews existing docs and suggests specific improvements backed by evidence.

**Auracoil owns a fenced region** in AGENTS.md (`<!-- auracoil:begin -->` / `<!-- auracoil:end -->`). It never edits content outside this region. This is how it coexists with Interdoc and manual edits.

## Prerequisites

- AGENTS.md must exist (run `/interdoc` first if it doesn't)
- Oracle CLI must be installed and have an active ChatGPT session
- X11 stack must be running (Xvfb, x11vnc — managed via systemd)

## Workflow

### Step 1: Check Prerequisites

```bash
# Verify Oracle session is alive
auracoil health
```

If Oracle is down, tell the user:
- "Oracle's browser session needs to be re-established"
- "Open NoVNC and log into ChatGPT, then retry"

If AGENTS.md doesn't exist:
- "No AGENTS.md found. Run /interdoc to generate one first, then I'll enhance it with GPT's review."

### Step 2: Ensure Auracoil Region

Read AGENTS.md. If it doesn't contain `<!-- auracoil:begin -->` markers, add them at the end of the document. This is a non-destructive append.

### Step 3: Run Review

```bash
auracoil review
```

This sends the existing AGENTS.md + key source files to GPT 5.2 Pro. Takes 5-15 minutes. The review is saved to `.auracoil/reviews/review-YYYY-MM-DD.json`.

### Step 4: Parse and Present Suggestions

Read the review output from `.auracoil/reviews/`. GPT returns JSON with structured suggestions:

```json
{
  "suggestions": [
    {
      "id": "missing-test-cmd",
      "severity": "high",
      "section": "Quick Start",
      "type": "add",
      "suggestion": "Add test command: `npm run test:run`",
      "evidence": "package.json has test:run script but AGENTS.md omits it"
    }
  ],
  "summary": "Documentation is solid but missing test commands and a gotcha about ESM imports."
}
```

Present each suggestion to the user:
- Show severity, what to change, and why (evidence)
- Group by section
- Let the user approve/reject each suggestion

### Step 5: Apply Approved Changes

For approved suggestions:
- Read current AGENTS.md
- Extract the Auracoil region
- Apply the approved changes to the region content
- Write back using `replaceRegion()` — only the Auracoil section changes
- Update `.auracoil/state.json` with the new review metadata

### Step 6: Report

Show what was applied:
- N suggestions approved, M rejected
- Sections updated
- Next review recommended: [date based on change velocity]

## When to Suggest Running Auracoil

The agent should suggest running Auracoil when:
- AGENTS.md exists but has no Auracoil region (first review)
- It's been 7+ days since the last review AND significant changes occurred
- User explicitly asks for cross-AI review or GPT feedback on docs
- After a major feature branch is merged

Do NOT suggest Auracoil:
- After every commit (too expensive)
- When Oracle is known to be unavailable
- For trivial documentation changes

## Key Principles

1. **Critic, not generator** — GPT reviews and suggests, never rewrites
2. **Region ownership** — Only edit between `auracoil:begin/end` markers
3. **Evidence-backed** — Every suggestion must cite files or commits
4. **User approval required** — Never auto-apply GPT suggestions
5. **Accretive** — State tracks what was reviewed, findings persist until resolved
```

**Step 5: Commit**

```bash
git add .claude-plugin/ skills/ commands/
git commit -m "feat: add Claude Code plugin structure — skill, command, marketplace"
```

---

## Task 8: Update Tests and Verify Everything

**Files:**
- Modify: `src/generator/gpt-analyzer.test.ts` (remove or update for new structure)
- Run: all tests

**Step 1: Remove tests for deleted modules**

The `gpt-analyzer.test.ts` tests `validateSections`, `extractSection`, `replaceSection` — these are being replaced by the region parser. Remove this test file since the module it tests is being superseded.

```bash
rm src/generator/gpt-analyzer.test.ts
rm src/generator/gpt-analyzer.ts
```

**Step 2: Run all remaining tests**

Run: `npx vitest run`
Expected: All tests pass:
- `src/security/secret-scanner.test.ts` (5 tests)
- `src/analyzer/context-builder.test.ts` (6 tests)
- `src/integrations/oracle.test.ts` (2+ tests)
- `src/state/state-manager.test.ts` (4 tests)
- `src/regions/region-parser.test.ts` (4 tests)
- `src/prompts/review-prompt.test.ts` (3 tests)

**Step 3: Build**

Run: `npm run build`
Expected: No errors

**Step 4: Integration test**

Run: `node dist/index.js review --skip-preflight` (on Auracoil itself)
Expected: Should fail gracefully with "No AGENTS.md found" or proceed to Oracle call

**Step 5: Commit**

```bash
git add -A
git commit -m "chore: clean up tests and verify build for v2"
```

---

## Task 9: Update Project Documentation

**Files:**
- Modify: `AGENTS.md`
- Modify: `CLAUDE.md`
- Modify: `package.json` (version bump)

**Step 1: Bump version**

In `package.json`, change `"version": "0.1.0"` → `"version": "0.2.0"`

**Step 2: Update AGENTS.md**

Update to reflect the new architecture: reviewer not generator, plugin structure, region ownership model.

**Step 3: Update CLAUDE.md**

Ensure it points to updated AGENTS.md.

**Step 4: Commit**

```bash
git add package.json AGENTS.md CLAUDE.md
git commit -m "docs: update for v0.2.0 — reviewer architecture"
```

---

## Summary: What v0.2.0 Delivers

| Before (v0.1.0) | After (v0.2.0) |
|---|---|
| 8 commands (generate, init, capture, search, update, health, diff, apply) | 4 commands (review, health, diff, apply) |
| GPT generates complete AGENTS.md from scratch | GPT reviews existing AGENTS.md and returns suggestions |
| Each run replaces previous output | Each run builds on state, tracks findings |
| Conflicts with Interdoc over file ownership | Region markers: each tool owns its section |
| No pre-flight check; fails silently after minutes | Oracle session check before any work begins |
| Standalone CLI only | Claude Code plugin (skill + command + CLI backend) |
| No persistent state | `.auracoil/state.json` tracks reviews and findings |

## What v0.2.0 Does NOT Include (Future)

- Hooks (deferred — manual invocation only for now)
- Doc CI / instruction tests (valuable but separate effort)
- Event-sourced findings ledger (state.json is the simple version)
- Docs-as-data YAML rendering (over-engineering for now)
- Async hook orchestration on SessionEnd

These are expansion points for v0.3+ when the core reviewer loop is proven.
