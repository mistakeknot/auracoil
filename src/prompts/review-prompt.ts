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
