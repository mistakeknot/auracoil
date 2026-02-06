import { describe, it, expect } from 'vitest';
import { validateSections, extractSection, replaceSection } from './gpt-analyzer.js';

describe('GPT Analyzer', () => {
  describe('validateSections', () => {
    it('should validate content with all required sections', () => {
      const content = `
## Overview
Content here

## Quick Start
Content here

## Architecture
Content here
`;
      const result = validateSections(content);
      expect(result.valid).toBe(true);
      expect(result.missing).toHaveLength(0);
    });

    it('should identify missing sections', () => {
      const content = `
## Overview
Content here
`;
      const result = validateSections(content);
      expect(result.valid).toBe(false);
      expect(result.missing.length).toBeGreaterThan(0);
    });
  });

  describe('extractSection', () => {
    it('should extract section content', () => {
      const content = `
<!-- auracoil:section:overview -->
## Overview
This is the overview content.
<!-- auracoil:end:overview -->

<!-- auracoil:section:quickstart -->
## Quick Start
Install instructions here.
<!-- auracoil:end:quickstart -->
`;
      const overview = extractSection(content, 'overview');
      expect(overview).toContain('This is the overview content');

      const quickstart = extractSection(content, 'quickstart');
      expect(quickstart).toContain('Install instructions here');
    });

    it('should return null for missing section', () => {
      const content = '## Some content without markers';
      const result = extractSection(content, 'overview');
      expect(result).toBeNull();
    });
  });

  describe('replaceSection', () => {
    it('should replace existing section', () => {
      const content = `
<!-- auracoil:section:overview -->
Old content
<!-- auracoil:end:overview -->
`;
      const result = replaceSection(content, 'overview', 'New content');
      expect(result).toContain('New content');
      expect(result).not.toContain('Old content');
    });

    it('should append new section if not exists', () => {
      const content = '## Some header';
      const result = replaceSection(content, 'overview', 'New section content');
      expect(result).toContain('auracoil:section:overview');
      expect(result).toContain('New section content');
      expect(result).toContain('auracoil:end:overview');
    });
  });
});
