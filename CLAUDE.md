# Auracoil

> See [AGENTS.md](./AGENTS.md) for full development guide.

## Overview

GPT 5.2 Pro reviewer for AGENTS.md. Auracoil is a **critic** (not a generator) -- it reviews existing documentation via Oracle and suggests evidence-backed improvements. Works alongside Interdoc: Interdoc generates, Auracoil reviews.

## Status

v0.2.0, in development. Claude Code plugin with `/auracoil` slash command.

## Quick Commands

```bash
auracoil review        # Send docs to GPT for critique
auracoil health        # Staleness metrics + Oracle status
auracoil diff          # Show suggested changes
auracoil apply         # Apply approved suggestions
npm run build          # Build (tsc)
npx vitest run         # Test (26 tests, 6 suites)
```

## Design Decisions (Do Not Re-Ask)

- Auracoil is a reviewer/critic, not a doc generator (that is Interdoc)
- Region ownership via `<!-- auracoil:begin/end -->` markers -- never edit outside
- Oracle (GPT 5.2 Pro) is the review engine, not Claude
- User approval required before applying any suggestion
- Persistent state in `.auracoil/state.json`
