import { describe, it, expect } from 'vitest';
import { hashContent, getBundleHash, getBundleFiles, formatBundleSummary } from './context-builder.js';

describe('Context Builder', () => {
  describe('hashContent', () => {
    it('should produce consistent hashes', () => {
      const hash1 = hashContent('test content');
      const hash2 = hashContent('test content');
      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different content', () => {
      const hash1 = hashContent('content A');
      const hash2 = hashContent('content B');
      expect(hash1).not.toBe(hash2);
    });

    it('should return 16 character hex string', () => {
      const hash = hashContent('test');
      expect(hash).toMatch(/^[a-f0-9]{16}$/);
    });
  });

  describe('getBundleFiles', () => {
    it('should flatten all file arrays', () => {
      const bundle = {
        manifests: ['package.json'],
        entrypoints: ['src/index.ts'],
        configs: ['tsconfig.json'],
        docs: ['README.md'],
        samples: ['src/example.ts'],
        contentHashes: new Map(),
        totalTokenEstimate: 1000,
      };

      const files = getBundleFiles(bundle);
      expect(files).toHaveLength(5);
      expect(files).toContain('package.json');
      expect(files).toContain('src/index.ts');
    });
  });

  describe('getBundleHash', () => {
    it('should produce consistent hash for same bundle', () => {
      const hashes = new Map([['file1', 'abc123'], ['file2', 'def456']]);
      const bundle = {
        manifests: [],
        entrypoints: [],
        configs: [],
        docs: [],
        samples: [],
        contentHashes: hashes,
        totalTokenEstimate: 0,
      };

      const hash1 = getBundleHash(bundle);
      const hash2 = getBundleHash(bundle);
      expect(hash1).toBe(hash2);
    });
  });

  describe('formatBundleSummary', () => {
    it('should format bundle summary', () => {
      const bundle = {
        manifests: ['package.json'],
        entrypoints: ['src/index.ts'],
        configs: [],
        docs: ['README.md'],
        samples: [],
        contentHashes: new Map(),
        totalTokenEstimate: 5000,
      };

      const summary = formatBundleSummary(bundle);
      expect(summary).toContain('Manifests:');
      expect(summary).toContain('1 files');
      expect(summary).toContain('5,000');
    });
  });
});
