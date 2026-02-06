import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

export interface Finding {
  id: string;
  severity: 'low' | 'medium' | 'high';
  section: string;
  suggestion: string;
  evidence: string;
  status: 'open' | 'resolved';
  introducedAt: string;
  resolvedAt?: string;
}

export interface AuracoilState {
  lastReviewedCommit: string | null;
  lastReviewedAt: string | null;
  agentsMdHash: string | null;
  findings: Finding[];
}

const EMPTY_STATE: AuracoilState = {
  lastReviewedCommit: null,
  lastReviewedAt: null,
  agentsMdHash: null,
  findings: [],
};

export class StateManager {
  private statePath: string;

  constructor(repoRoot: string) {
    this.statePath = join(repoRoot, '.auracoil', 'state.json');
  }

  async load(): Promise<AuracoilState> {
    try {
      const raw = await readFile(this.statePath, 'utf-8');
      return { ...EMPTY_STATE, ...JSON.parse(raw) };
    } catch {
      return { ...EMPTY_STATE };
    }
  }

  async update(partial: Partial<AuracoilState>): Promise<void> {
    const current = await this.load();
    const updated = { ...current, ...partial };
    await mkdir(join(this.statePath, '..'), { recursive: true });
    await writeFile(this.statePath, JSON.stringify(updated, null, 2));
  }

  async addFinding(finding: Omit<Finding, 'status' | 'introducedAt'>): Promise<void> {
    const current = await this.load();
    if (current.findings.some(f => f.id === finding.id)) return;
    current.findings.push({
      ...finding,
      status: 'open',
      introducedAt: new Date().toISOString(),
    });
    await this.save(current);
  }

  async resolveFinding(id: string): Promise<void> {
    const current = await this.load();
    const finding = current.findings.find(f => f.id === id);
    if (finding) {
      finding.status = 'resolved';
      finding.resolvedAt = new Date().toISOString();
      await this.save(current);
    }
  }

  private async save(state: AuracoilState): Promise<void> {
    await mkdir(join(this.statePath, '..'), { recursive: true });
    await writeFile(this.statePath, JSON.stringify(state, null, 2));
  }
}
