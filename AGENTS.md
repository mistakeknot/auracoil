# AGENTS.md

> Documentation for AI coding assistants (Claude Code, Codex CLI).

## Overview

Auracoil v0.2.0 is a **reviewer/critic** for AGENTS.md documentation. It sends existing docs to GPT 5.2 Pro (via Oracle) for cross-AI review and returns structured, evidence-backed suggestions. It does not generate documentation -- that is Interdoc's job. Auracoil reviews what already exists and proposes targeted improvements.

**Author-Critic-Applier pattern:** Interdoc (or a human) authors AGENTS.md. Auracoil critiques it via GPT. The user approves/rejects suggestions. Auracoil applies approved changes to its own fenced region only.

## Quick Commands

```bash
# Review: send AGENTS.md to GPT 5.2 Pro for critique (Oracle required)
auracoil review

# Health: show staleness metrics, review history, Oracle status
auracoil health

# Diff: show what GPT suggested vs. current AGENTS.md
auracoil diff

# Apply: write approved suggestions into the Auracoil region
auracoil apply

# Install deps
npm install

# Build
npm run build          # tsc -> dist/

# Test
npx vitest run         # vitest run (one-shot)
npm run test:run       # vitest run (one-shot, via npm script)
npm test               # vitest (watch mode)

# Dev
npm run dev            # tsc --watch

# Lint
npm run lint           # eslint src/

# Typecheck
npm run typecheck      # tsc --noEmit

# Start (runs built CLI)
npm start              # node dist/index.js
```

**Useful flags:**
- `auracoil review --skip-preflight` — bypass Oracle session health check
- `auracoil diff --file <review.json>` — diff a specific review file
- `auracoil apply --file <review.json>` — apply a specific review file

## Architecture

### Core Concepts

- **Region ownership**: Auracoil owns `<!-- auracoil:begin -->` / `<!-- auracoil:end -->` markers in AGENTS.md. It never edits content outside these markers. Interdoc and manual edits own everything else.
- **Persistent state**: `.auracoil/state.json` tracks last reviewed commit, content hash, and open findings. Reviews are saved to `.auracoil/reviews/`.
- **Two-loop cadence**: Inner loop (daily dev) uses Interdoc for fast doc generation. Outer loop (weekly/milestone) uses Auracoil for GPT-powered critique.
- **Evidence-backed suggestions**: GPT must cite file paths or commit messages for every suggestion. No hallucinated improvements.

### Data Flow

```
User runs: auracoil review
  -> Pre-flight check (Oracle available?)
  -> Read AGENTS.md + gather changed files + recent commits
  -> Build review prompt (src/prompts/review-prompt.ts)
  -> Send to GPT 5.2 Pro via Oracle CLI
  -> Save structured JSON review to .auracoil/reviews/
  -> User runs: auracoil diff (inspect suggestions)
  -> User runs: auracoil apply (write approved changes to region)
```

### Directory Structure

```
src/
  index.ts                     # CLI entry (Commander.js), 4 commands
  commands/
    review.ts                  # Send AGENTS.md to GPT for review
    health.ts                  # Staleness metrics, review history
    diff.ts                    # Show diff between suggestions and current doc
    apply.ts                   # Apply approved suggestions to Auracoil region
  regions/
    region-parser.ts           # Extract/replace/ensure Auracoil region markers
    region-parser.test.ts
  state/
    state-manager.ts           # Load/save .auracoil/state.json, manage findings
    state-manager.test.ts
  prompts/
    review-prompt.ts           # Build the GPT critic prompt
    review-prompt.test.ts
  analyzer/
    context-builder.ts         # Build file context bundles for Oracle
    context-builder.test.ts
    repo-indexer.ts            # Index repo structure for review context
  security/
    secret-scanner.ts          # Prevent secrets from leaking into Oracle prompts
    secret-scanner.test.ts
  integrations/
    oracle.ts                  # Oracle CLI wrapper (spawn, parse, health check)
    oracle.test.ts

plugin.json                      # Plugin manifest (declares skills/commands)
package.json                     # scripts, deps, Node engine requirement
tsconfig.json                    # TS compiler settings (NodeNext, outDir dist/, strict)

.claude-plugin/
  plugin.json                  # Claude Code plugin metadata
  marketplace.json             # Dev marketplace registration

skills/
  auracoil/
    SKILL.md                   # Skill instructions (when/how Claude should invoke Auracoil)

commands/
  auracoil.md                  # /auracoil slash command definition

.auracoil/                     # Runtime state (gitignored)
  state.json                   # Review history, findings, content hashes
  reviews/                     # Saved review JSON files
```

## Code Conventions

- **TypeScript, ESM**: `"type": "module"` in package.json, NodeNext module resolution
- **`.js` in imports**: All relative imports in `.ts` files use `.js` extensions (required by NodeNext ESM)
- **Commander.js**: CLI framework, command-per-module pattern
- **chalk**: Terminal output formatting
- **vitest**: Test runner, co-located test files (`*.test.ts`)
- **Naming**: `camelCase` functions/vars, `PascalCase` types/interfaces, `SCREAMING_SNAKE_CASE` constants
- **Import order**: External packages first, then internal relative modules

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | CLI entry, wires 4 commands (review, health, diff, apply) |
| `src/regions/region-parser.ts` | `extractRegion()`, `replaceRegion()`, `ensureRegion()` |
| `src/state/state-manager.ts` | `StateManager` class, `Finding` and `AuracoilState` interfaces |
| `src/prompts/review-prompt.ts` | `buildReviewPrompt()` -- constructs the GPT critic prompt |
| `src/integrations/oracle.ts` | `runOracle()`, `isOracleAvailable()`, `checkOracleSession()` |
| `src/security/secret-scanner.ts` | Filters dangerous files before sending to Oracle |
| `src/analyzer/context-builder.ts` | Builds file bundles with content hashing |

## Oracle Dependency

Auracoil requires Oracle for the `review` command. Oracle is a CLI that drives GPT 5.2 Pro via a browser session.

**Environment variables** (must be set in the shell, not inherited by Claude Code's Bash tool):
```bash
DISPLAY=:99
CHROME_PATH=/usr/local/bin/google-chrome-wrapper
```

**Pre-flight check**: The `review` command checks Oracle availability before sending prompts. Use `--skip-preflight` to bypass. If Oracle is unavailable, the user must open NoVNC and log into ChatGPT.

## Plugin Structure

Auracoil is a Claude Code plugin with a skill and a slash command:

- **`plugin.json`**: Plugin manifest — declares exported **skills** and **commands**. Update this when adding/removing `skills/` entries or slash commands.
- **`.claude-plugin/plugin.json`**: Plugin metadata (name, version, description)
- **`skills/auracoil/SKILL.md`**: Instructions for when/how Claude should invoke Auracoil (prerequisites, workflow steps, key principles)
- **`commands/auracoil.md`**: The `/auracoil` slash command definition

The skill teaches Claude to: check prerequisites, ensure the Auracoil region exists, run review, present suggestions for approval, and apply approved changes.

## Gotchas

- **Build before run**: `npm start` runs `dist/index.js`, so `npm run build` is required after TS changes
- **Oracle session expiry**: If Oracle fails with ECONNREFUSED or Cloudflare challenge, the user must re-authenticate via NoVNC
- **Region markers required**: `apply` and `diff` commands throw if `<!-- auracoil:begin/end -->` markers are missing from AGENTS.md
- **Node >= 20 required**: ESM features and module behavior depend on Node 20+

<!-- auracoil:begin -->
## Auracoil Review Notes

_This section is maintained by Auracoil (GPT 5.2 Pro reviewer). Do not edit manually._

### Status

- **Last review:** 2026-02-06 — 6 suggestions (all approved)
- **Latest evidence snapshot:** commit `fix: add skills/commands declarations to plugin.json` (changed: `.claude-plugin/plugin.json`, `plugin.json`)
- **Next action:** run `auracoil review` after next significant code change

### Open findings

_None — all suggestions from 2026-02-06 review applied._
<!-- auracoil:end -->
