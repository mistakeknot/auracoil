🧿 oracle 0.8.5 — Quiet prompt, thunderous answers.
Launching browser mode (gpt-5.2-pro) with ~139 tokens.
This run can take up to an hour (usually ~10 minutes).
Answer:
You’ve basically built a **stateless “rewrite the whole doc” generator**, then attached it to **high-frequency triggers**. That combination guarantees (a) non-accretive behavior, (b) conflicts with anything else touching the same file, and (c) unacceptable latency/cost.

Below is a concrete way to restructure Auracoil so it **accumulates**, **doesn’t fight Interdoc**, and **uses GPT 5.2 Pro only when it’s worth it**.

---

## 1) The right relationship between GPT review and Claude generation

### Recommended: Claude = “evidence + draft”, GPT = “editor/critic”, tool = “applier”

**Why this fits your constraints:**

* Claude Code is already sitting “next to” the repo and tools; it can cheaply gather ground truth (commands, file layout, failures).
* GPT calls are expensive and slow, so you want GPT spending time on **high-leverage editorial judgement**, not rediscovering repo facts.
* You eliminate hallucinated build/test commands by making GPT operate on an **evidence pack** instead of the whole repo.

**Flow**

1. **Evidence Pack (Claude / local scripts):**

   * Read current `AGENTS.md` (and any aux agent docs).
   * Compute `git diff` since last run.
   * Extract concrete signals: CI failures, repeated tool errors, “I couldn’t run X” messages, new packages/frameworks.
2. **Draft Patch (Claude):**

   * Produce a *candidate* change in a constrained form (JSON patch or unified diff).
3. **Review & refine patch (GPT 5.2 Pro):**

   * GPT sees: existing doc content + evidence pack + candidate patch.
   * GPT returns: a refined patch + risk/justification.
4. **Deterministic apply + validate (code, not model):**

   * Apply patch only where allowed.
   * Run doc lint + “instruction tests” (more below).
   * Commit/PR.

This “author → critic → applier” split is the single biggest lever to stop replacement behavior.

### Alternative (only if you must): GPT generates, Claude validates

If you truly want GPT to “write,” you still need a **hard guardrail**: Claude (or scripts) validates that any command GPT introduces actually exists/runs (or is explicitly marked “example”). Otherwise the doc will drift.

---

## 2) How to make enhancement truly accretive

Accretive means: **the system has memory (state), uses the current doc as input, and applies changes incrementally with merge rules**. Right now you’re missing all three.

### A. Give each tool an “owned region” in `AGENTS.md` (eliminate Interdoc conflicts)

Make `AGENTS.md` a composition of regions, not a single free-for-all document.

Example structure:

```md
# AGENTS.md

## Human-owned baseline (do not edit automatically)
...

<!-- auracoil:auto:begin -->
## Agent instructions (auto-maintained by Auracoil)
...
<!-- auracoil:auto:end -->

<!-- interdoc:auto:begin -->
## Repo reference (auto-maintained by Interdoc)
...
<!-- interdoc:auto:end -->
```

**Rule:** Auracoil only edits the Auracoil block; Interdoc only edits the Interdoc block.
This mirrors the “namespacing prevents conflicts” idea Claude Code uses for plugin commands/skills, but applied to file mutation boundaries. ([Claude Code][1])

### B. Switch from “write file” to “generate patch”

**Never** ask GPT/Claude to output the full `AGENTS.md`. Ask for a patch constrained to owned regions.

Two good options:

#### Option 1: Unified diff (simple and Git-native)

Prompt contract: “Output a unified diff that only changes lines between `auracoil:auto:begin/end`.”

Deterministic applier:

* Verify diff only touches the allowed region.
* Apply with `git apply`.
* If patch fails, open a PR with the diff instead of forcing.

#### Option 2: Structured operations (more robust)

Example JSON schema:

```json
{
  "target": "AGENTS.md",
  "region": "auracoil:auto",
  "ops": [
    {"type": "replace_section", "section_id": "setup-commands", "content": "..."},
    {"type": "append_bullets", "section_id": "boundaries", "items": ["..."] }
  ],
  "notes": [{"why": "...", "evidence": ["git:...","error:..."]}],
  "risk": "low|medium|high"
}
```

The applier:

* Parses Markdown into section IDs (headings).
* Applies operations deterministically.
* Refuses anything outside the contract.

### C. Include existing docs in the prompt (and keep them in the loop forever)

Right now your prompt “lacks existing docs.” That guarantees non-accretion.

Minimum viable prompt inputs:

* Current Auracoil-owned region content (or entire `AGENTS.md` if small).
* Last-run metadata (see below).
* Evidence pack (diff summary, failures).
* A rubric for what “good” looks like.

AGENTS.md is explicitly intended as a predictable place for agent instructions; treating it as required context is aligned with the format’s intent. ([Agents][2])

### D. Persist state so the system knows what it already did

Create `.auracoil/state.json`:

```json
{
  "last_reviewed_commit": "abc123",
  "last_gpt_review_at": "2026-02-01T10:20:00Z",
  "agents_md_hash": "…",
  "open_findings": [
    {"id":"missing-test-command","status":"open","introduced":"2026-01-15"}
  ]
}
```

This enables:

* Diff-based evidence: “Only consider changes since `last_reviewed_commit`.”
* Throttling: “Don’t run GPT more than once per week unless high severity.”
* True accretion: open findings are tracked until resolved.

### E. Add an “AGENTS change log” (optional but powerful)

Inside the Auracoil block, keep a small “Recent updates” section:

* Date
* What changed
* Why (linked to evidence)

This is the simplest form of “accretion pressure” that prevents silent rewrites.

### F. (Best) Treat AGENTS content as data, render to Markdown

If you want *really* stable diffs and low hallucination risk:

* Source of truth: `.auracoil/agents.yml`
* Renderer generates Auracoil block in `AGENTS.md`

Models update YAML (structured), renderer handles formatting and ordering. This is the “docs compiler” pattern and it’s extremely effective when multiple systems contribute.

---

## 3) Best trigger cadence given 5–30 minute GPT calls

You want a **two-loop cadence**:

### Inner loop (cheap, frequent): collect signals, don’t call GPT

Run on:

* `PostToolUse` for `Write|Edit` (file changes)
* `PostToolUseFailure` (failed commands)
* “agent got stuck” patterns

These hooks exist and can fire repeatedly inside the agentic loop. ([Claude Code][3])

Action:

* Update `.auracoil/state.json` (dirty flags, failure counts, touched paths).
* Optionally run *local* checks (fast): `markdownlint`, link check, grep for outdated commands.

### Outer loop (expensive, infrequent): GPT deep review only when warranted

Good defaults:

**Run GPT review when any of these are true:**

* **Time-based:** once every 7 days (or per sprint) on active repos.
* **Commit-based:** after N merges to main (e.g., 20) *and* repo “instruction-relevant” files changed (CI config, package manager files, build scripts).
* **Failure-based:** after 3+ repeats of the same setup/test failure within a day.
* **Manual:** `/auracoil:review-agents` (always available).

### Use async hooks so GPT never blocks the interactive loop

Claude Code supports running **command hooks in the background** via `"async": true`, and can deliver results back to Claude as context on the next turn. ([Claude Code][3])

Practical pattern:

* Hook `Stop` or `SessionEnd` → run `auracoil-triage.sh`
* If triage says “escalate,” spawn `auracoil-gpt-review.sh` **async**.

Important: async hooks are **not deduplicated automatically**, so you must implement your own “single flight” lock (PID file / flock). ([Claude Code][3])

### What “too frequent” looks like

If GPT is 5–30 minutes, anything like “on every write” is a non-starter. The right cadence is:

* **always-on cheap telemetry**
* **rare expensive synthesis**

---

## 4) What you’re missing about improving coding agents via cross-AI doc review

Cross-AI doc review is useful, but it won’t reliably improve agent performance unless you close these loops:

### A. Observability: feed the doc with real failure data

The best “what to add to AGENTS.md” signal is not opinions—it’s:

* commands that failed
* missing environment assumptions
* repeated “where is X?” questions
* tool permission denials
* time sinks (install steps, migrations)

Capture and summarize these into the evidence pack.

### B. Evals: treat AGENTS.md as something you can *test*

Create an “instruction test” script, e.g. `./scripts/agent-smoke.sh`:

* Runs the setup commands listed in AGENTS.md (or validates they exist)
* Runs the test command
* Verifies formatting/lint commands exist
* Optionally verifies “boundaries” (agent should not touch `/prod`, etc.)

If a doc update breaks the instruction test, it doesn’t merge.

This makes doc quality measurable, not subjective.

### C. Progressive disclosure: keep AGENTS.md short, link out for depth

Successful agent instruction files tend to:

* put executable commands early
* provide concrete examples
* define clear boundaries (“always/ask/never”)
* specify the stack precisely (versions, key tools) ([The GitHub Blog][4])

Use AGENTS.md as the “briefing packet,” and link to deeper docs where necessary—otherwise every auto-update makes it longer and noisier.

### D. Avoid “reviewer hallucinations” with evidence-backed constraints

Cross-model setups fail when the reviewer invents improvements.
Fix: require that any new command/path introduced by GPT must be backed by:

* repo facts (collected by Claude/scripts)
* or explicit “example only” labeling

### E. Leverage AGENTS discovery rules to reduce churn

Codex builds an instruction chain by looking for `AGENTS.override.md` / `AGENTS.md` in global and project scopes, walking from project root down to the working directory. ([OpenAI Developers][5])

Architecturally, this enables:

* a stable, human-authored baseline at repo root
* more specific, rarely-changing instructions in subdirectories
* tool- or environment-specific overrides without rewriting everything

Even if Claude Code doesn’t use the exact same discovery semantics, the *design idea* (layered instructions) reduces conflict and rewrite pressure.

---

## 5) Architectural patterns that solve this well

Here are patterns that work in practice, with “how to implement” notes.

### Pattern 1: Author–Critic–Applier (most important)

* **Author (Claude):** generates candidate patch from repo facts
* **Critic (GPT):** improves clarity, removes contradictions, enforces rubric
* **Applier (tool):** deterministic, constrained patch apply + validation

This prevents “replace instead of accrete” by design.

### Pattern 2: Region ownership markers (conflict killer)

* Each plugin owns a fenced region in `AGENTS.md`
* Hard checks prevent edits outside region
* Interdoc and Auracoil stop stepping on each other

### Pattern 3: Change-score scheduler (cost control)

Compute a score from signals:

* touched files include `package.json`, lockfiles, CI workflows, build scripts
* repeated failures in setup/test
* new language/tooling detected
* time since last review

Only call GPT if score ≥ threshold.

### Pattern 4: Event-sourced doc ledger (true accretion)

Instead of “rewrite AGENTS.md,” store findings as entries:

`/docs/agent/findings/2026-02-06.json`

* finding
* evidence
* proposed doc change
* status (open/resolved)

Then a composer generates the Auracoil block. This makes accumulation explicit and auditable.

### Pattern 5: Docs-as-data with a renderer (stability + low drift)

* Source: YAML/JSON describing commands, boundaries, stack, examples
* Renderer emits consistent Markdown
* Models edit structured fields, not prose blobs

### Pattern 6: Doc CI (quality gate)

* markdownlint
* link check
* “instruction tests”
* optionally a tiny “agent-run” eval: can an agent follow the doc to run tests?

### Pattern 7: Async hook orchestration (latency hiding)

Use Claude Code hooks to:

* collect signals synchronously
* run expensive synthesis asynchronously with `"async": true`
* deliver “additionalContext” back next turn ([Claude Code][3])

---

## A concrete, minimal “next implementation” checklist

If you do only one pass, do this:

1. **Add Auracoil fenced region to `AGENTS.md`** and enforce “only edit inside.”
2. **Persist `.auracoil/state.json`** with last reviewed commit/hash.
3. **Change GPT contract to patch-only** (unified diff or JSON ops).
4. **Introduce a triage step** (cheap) that decides whether GPT is needed.
5. **Run GPT via async hook** on `Stop`/`SessionEnd`, with a lock to dedupe. ([Claude Code][3])
6. **Add at least one validation**: “do the commands in AGENTS.md exist?”
7. **Define plugin boundaries with Interdoc**: each edits its own region, full stop.

That set directly fixes all four problems you listed.

---

If you want, I can also sketch:

* a concrete **evidence-pack format** (what fields to collect, what to omit),
* a **prompt template** for GPT-as-critic that yields patch-only output,
* and a **merge policy** (when to auto-apply vs PR vs “suggest only”).

[1]: https://code.claude.com/docs/en/plugins "Create plugins - Claude Code Docs"
[2]: https://agents.md/ "AGENTS.md"
[3]: https://code.claude.com/docs/en/hooks "Hooks reference - Claude Code Docs"
[4]: https://github.blog/ai-and-ml/github-copilot/how-to-write-a-great-agents-md-lessons-from-over-2500-repositories/ "How to write a great agents.md: Lessons from over 2,500 repositories - The GitHub Blog"
[5]: https://developers.openai.com/codex/guides/agents-md/ "Custom instructions with AGENTS.md"


14m36s · gpt-5.2-pro[browser] · ↑139 ↓3.35k ↻0 Δ3.49k
