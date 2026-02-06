/**
 * CLAUDE.md Pointer Generator
 *
 * Creates a slim CLAUDE.md that points to AGENTS.md.
 * Only includes Claude-specific settings if any.
 */

import { writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import chalk from 'chalk';

export interface ClaudeMdOptions {
  dryRun?: boolean;
  claudeSpecific?: string;  // Optional Claude-specific content
}

const CLAUDE_MD_TEMPLATE = `# CLAUDE.md

> See [AGENTS.md](./AGENTS.md) for project documentation.

This file is a pointer to the main documentation. AGENTS.md contains:
- Project overview and architecture
- Code conventions and patterns
- Development commands
- Gotchas and edge cases

{{CLAUDE_SPECIFIC}}
`;

/**
 * Write CLAUDE.md as a pointer to AGENTS.md
 */
export async function writeClaudeMdPointer(
  repoPath: string,
  options: ClaudeMdOptions = {}
): Promise<{ written: boolean; path: string }> {
  const claudePath = join(repoPath, 'CLAUDE.md');

  // Build content
  let content = CLAUDE_MD_TEMPLATE;

  if (options.claudeSpecific) {
    content = content.replace(
      '{{CLAUDE_SPECIFIC}}',
      `## Claude-Specific Settings\n\n${options.claudeSpecific}`
    );
  } else {
    content = content.replace('{{CLAUDE_SPECIFIC}}', '');
  }

  // Clean up extra newlines
  content = content.replace(/\n\n\n+/g, '\n\n').trim() + '\n';

  if (options.dryRun) {
    console.log(chalk.dim('\n  [Dry run] Would write CLAUDE.md:'));
    console.log(chalk.dim('  ' + content.split('\n').join('\n  ')));
    return { written: false, path: claudePath };
  }

  await writeFile(claudePath, content);
  console.log(chalk.green(`  ✓ Written ${claudePath}`));

  return { written: true, path: claudePath };
}

/**
 * Check if existing CLAUDE.md is a pointer or has custom content
 */
export async function isPointerClaudeMd(repoPath: string): Promise<boolean> {
  const claudePath = join(repoPath, 'CLAUDE.md');

  try {
    const content = await readFile(claudePath, 'utf-8');

    // Check if it's our pointer format
    if (content.includes('See [AGENTS.md]')) {
      return true;
    }

    // Check if it's very short (likely a pointer)
    if (content.split('\n').length < 20) {
      return true;
    }

    return false;
  } catch {
    // File doesn't exist
    return true;
  }
}

/**
 * Extract Claude-specific content from existing CLAUDE.md
 */
export async function extractClaudeSpecific(repoPath: string): Promise<string | null> {
  const claudePath = join(repoPath, 'CLAUDE.md');

  try {
    const content = await readFile(claudePath, 'utf-8');

    // Look for Claude-specific section
    const match = content.match(/## Claude-Specific Settings\n\n([\s\S]*?)(?=\n##|$)/);
    if (match) {
      return match[1].trim();
    }

    return null;
  } catch {
    return null;
  }
}
