import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { StateManager } from './state-manager.js';

describe('StateManager', () => {
  let tempDir: string;
  let state: StateManager;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'auracoil-test-'));
    state = new StateManager(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true });
  });

  it('should initialize with empty state', async () => {
    const data = await state.load();
    expect(data.lastReviewedCommit).toBeNull();
    expect(data.findings).toEqual([]);
  });

  it('should persist and reload state', async () => {
    await state.update({
      lastReviewedCommit: 'abc123',
      lastReviewedAt: '2026-02-05T00:00:00Z',
      agentsMdHash: 'hash123',
    });
    const reloaded = new StateManager(tempDir);
    const data = await reloaded.load();
    expect(data.lastReviewedCommit).toBe('abc123');
  });

  it('should add and track findings', async () => {
    await state.addFinding({
      id: 'missing-test-cmd',
      severity: 'medium',
      section: 'Quick Start',
      suggestion: 'Add test command: npm test',
      evidence: 'package.json has test script but AGENTS.md omits it',
    });
    const data = await state.load();
    expect(data.findings).toHaveLength(1);
    expect(data.findings[0].status).toBe('open');
  });

  it('should resolve findings', async () => {
    await state.addFinding({
      id: 'missing-test-cmd',
      severity: 'medium',
      section: 'Quick Start',
      suggestion: 'Add test command',
      evidence: 'missing',
    });
    await state.resolveFinding('missing-test-cmd');
    const data = await state.load();
    expect(data.findings[0].status).toBe('resolved');
  });
});
