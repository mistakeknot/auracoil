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
