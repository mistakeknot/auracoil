/**
 * GPT Prompts for Analysis
 *
 * Structured prompts that yield stable, consistent output.
 *
 * Key patterns learned from Oracle:
 * - Minimal focused system prompt
 * - Cite files by path when relevant
 * - Collapse 3+ blank lines → 2 for stability
 * - Separate system/user roles clearly
 */

export const SYSTEM_PROMPT = `Generate AGENTS.md documentation for AI coding assistants. Cite specific file paths. Be concise and actionable.`;

export function getAnalysisPrompt(repoContext: RepoContext): string {
  return `Analyze this ${repoContext.languages.join('/')} project "${repoContext.name}" and generate AGENTS.md with these sections:

1. **Overview** - What it does, tech stack (1-2 sentences)
2. **Quick Start** - Install/run/test commands
3. **Architecture** - Directory structure, key patterns, data flow
4. **Code Conventions** - Naming, file organization, imports
5. **Gotchas** - Things that could trip up an AI agent
6. **Common Patterns** - Code snippets showing project patterns

Output markdown directly. No explanatory text, just the documentation.`;
}

export interface RepoContext {
  name: string;
  languages: string[];
  frameworks: string[];
  structureSummary: string;
  entrypoints: string[];
}

export function buildRepoContext(
  name: string,
  languages: { name: string }[],
  frameworks: string[],
  entrypoints: string[]
): RepoContext {
  return {
    name,
    languages: languages.map(l => l.name),
    frameworks,
    structureSummary: inferStructure(entrypoints),
    entrypoints,
  };
}

function inferStructure(entrypoints: string[]): string {
  const patterns: string[] = [];

  if (entrypoints.some(e => e.includes('src/'))) {
    patterns.push('src/ layout');
  }
  if (entrypoints.some(e => e.includes('pages/'))) {
    patterns.push('pages-based routing');
  }
  if (entrypoints.some(e => e.includes('app/'))) {
    patterns.push('app directory');
  }
  if (entrypoints.some(e => e.includes('cmd/'))) {
    patterns.push('Go cmd pattern');
  }
  if (entrypoints.some(e => e.includes('lib/'))) {
    patterns.push('lib/ for shared code');
  }

  return patterns.join(', ') || 'standard layout';
}
