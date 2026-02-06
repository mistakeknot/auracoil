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
