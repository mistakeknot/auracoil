/**
 * GPT Analyzer
 *
 * Sends context to GPT 5.2 Pro via Oracle and processes the response.
 */

import chalk from 'chalk';
import { executeOracle } from '../integrations/oracle.js';
import { SYSTEM_PROMPT, getAnalysisPrompt, buildRepoContext, type RepoContext } from '../prompts/analysis-prompt.js';
import type { RepoIndex } from '../analyzer/repo-indexer.js';
import type { AnalysisBundle } from '../analyzer/context-builder.js';

export interface AnalysisResult {
  success: boolean;
  content: string;
  error?: string;
  tokenEstimate?: number;
}

/**
 * Analyze codebase using GPT 5.2 Pro
 */
export async function analyzeWithGPT(
  repoPath: string,
  index: RepoIndex,
  bundle: AnalysisBundle
): Promise<AnalysisResult> {
  // Build repo context
  const repoName = repoPath.split('/').pop() || 'project';
  const context = buildRepoContext(
    repoName,
    index.languages,
    index.frameworks,
    index.entrypoints
  );

  // Build prompt
  const prompt = `${SYSTEM_PROMPT}\n\n${getAnalysisPrompt(context)}`;

  // Get all files to send
  const files = [
    ...bundle.manifests,
    ...bundle.entrypoints,
    ...bundle.configs,
    ...bundle.docs,
    ...bundle.samples,
  ].map(f => `${repoPath}/${f}`);

  console.log(chalk.dim(`  Sending ${files.length} files to GPT 5.2 Pro...`));

  // Execute Oracle with generous timeout for large codebases
  // GPT-5.2-pro "thinking" mode can take 15-30 minutes for complex analysis
  const result = await executeOracle({
    prompt,
    files,
    model: 'gpt-5.2-pro',
    timeout: 1800000, // 30 minutes
  });

  if (!result.success) {
    return {
      success: false,
      content: '',
      error: result.error,
    };
  }

  // Extract markdown content from response
  const content = extractMarkdown(result.output);

  if (!content) {
    return {
      success: false,
      content: '',
      error: 'GPT response did not contain valid markdown',
    };
  }

  return {
    success: true,
    content,
    tokenEstimate: bundle.totalTokenEstimate,
  };
}

/**
 * Extract markdown content from GPT response
 */
function extractMarkdown(response: string): string | null {
  // Try to find markdown block
  const markdownMatch = response.match(/```markdown\n([\s\S]*?)```/);
  if (markdownMatch) {
    return markdownMatch[1].trim();
  }

  // Try to find content between section markers
  const sectionMatch = response.match(/<!-- auracoil:section:[\s\S]*<!-- auracoil:end:/);
  if (sectionMatch) {
    return response.trim();
  }

  // If response looks like markdown, use as-is
  if (response.includes('## ') && response.includes('#')) {
    return response.trim();
  }

  return null;
}

/**
 * Validate that response contains required sections
 */
export function validateSections(content: string): { valid: boolean; missing: string[] } {
  // Look for common section headers in markdown
  const requiredPatterns = [
    /##\s*overview/i,
    /##\s*quick\s*start/i,
    /##\s*architecture/i,
  ];

  const missing: string[] = [];

  for (const pattern of requiredPatterns) {
    if (!pattern.test(content)) {
      missing.push(pattern.source);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
  };
}

/**
 * Extract a specific section from content
 */
export function extractSection(content: string, sectionName: string): string | null {
  const startMarker = `<!-- auracoil:section:${sectionName} -->`;
  const endMarker = `<!-- auracoil:end:${sectionName} -->`;

  const startIdx = content.indexOf(startMarker);
  const endIdx = content.indexOf(endMarker);

  if (startIdx === -1 || endIdx === -1) {
    return null;
  }

  return content.substring(startIdx + startMarker.length, endIdx).trim();
}

/**
 * Replace a specific section in content
 */
export function replaceSection(
  content: string,
  sectionName: string,
  newContent: string
): string {
  const startMarker = `<!-- auracoil:section:${sectionName} -->`;
  const endMarker = `<!-- auracoil:end:${sectionName} -->`;

  const startIdx = content.indexOf(startMarker);
  const endIdx = content.indexOf(endMarker);

  if (startIdx === -1 || endIdx === -1) {
    // Section doesn't exist, append
    return content + `\n${startMarker}\n${newContent}\n${endMarker}\n`;
  }

  return content.substring(0, startIdx + startMarker.length) +
    '\n' + newContent + '\n' +
    content.substring(endIdx);
}
