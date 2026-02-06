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
