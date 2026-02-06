/**
 * Secret Scanner
 *
 * Scans files for potential secrets before sending to Oracle.
 * Defense in depth - prevents accidental credential exfiltration.
 */

import { readFile } from 'fs/promises';
import { join, basename } from 'path';

export interface SecretScanResult {
  safe: boolean;
  issues: SecretIssue[];
}

export interface SecretIssue {
  file: string;
  line: number;
  type: SecretType;
  snippet: string;  // Masked snippet showing context
}

export type SecretType =
  | 'api_key'
  | 'aws_credentials'
  | 'private_key'
  | 'password'
  | 'token'
  | 'connection_string'
  | 'sensitive_file';

// Files that should NEVER be sent to Oracle
const DANGEROUS_FILES = new Set([
  '.env',
  '.env.local',
  '.env.production',
  '.env.development',
  '.npmrc',
  '.netrc',
  'credentials.json',
  'secrets.json',
  'config/secrets.yml',
  'id_rsa',
  'id_ed25519',
  '.pem',
  '.key',
  'service-account.json',
  'gcloud-credentials.json',
]);

// Patterns that indicate secrets (regex + type)
const SECRET_PATTERNS: Array<{ pattern: RegExp; type: SecretType; description: string }> = [
  // API Keys (generic)
  {
    pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*['"]?([a-zA-Z0-9_\-]{20,})['"]?/gi,
    type: 'api_key',
    description: 'API key',
  },
  // AWS
  {
    pattern: /AKIA[0-9A-Z]{16}/g,
    type: 'aws_credentials',
    description: 'AWS Access Key ID',
  },
  {
    pattern: /(?:aws_secret_access_key|aws_secret)\s*[:=]\s*['"]?([a-zA-Z0-9/+=]{40})['"]?/gi,
    type: 'aws_credentials',
    description: 'AWS Secret Access Key',
  },
  // Private keys
  {
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
    type: 'private_key',
    description: 'Private key block',
  },
  // Passwords
  {
    pattern: /(?:password|passwd|pwd)\s*[:=]\s*['"]([^'"]{8,})['"]?/gi,
    type: 'password',
    description: 'Password',
  },
  // Tokens
  {
    pattern: /(?:token|bearer|auth)\s*[:=]\s*['"]?([a-zA-Z0-9_\-.]{20,})['"]?/gi,
    type: 'token',
    description: 'Auth token',
  },
  // GitHub tokens
  {
    pattern: /ghp_[a-zA-Z0-9]{36}/g,
    type: 'token',
    description: 'GitHub personal access token',
  },
  {
    pattern: /gho_[a-zA-Z0-9]{36}/g,
    type: 'token',
    description: 'GitHub OAuth token',
  },
  // Slack tokens
  {
    pattern: /xox[baprs]-[0-9]{10,13}-[a-zA-Z0-9-]+/g,
    type: 'token',
    description: 'Slack token',
  },
  // Connection strings
  {
    pattern: /(?:mongodb|postgres|mysql|redis):\/\/[^\s'"]+:[^\s'"]+@[^\s'"]+/gi,
    type: 'connection_string',
    description: 'Database connection string with credentials',
  },
  // Generic secrets
  {
    pattern: /(?:secret|private)\s*[:=]\s*['"]([^'"]{16,})['"]?/gi,
    type: 'api_key',
    description: 'Generic secret',
  },
];

/**
 * Scan files for secrets before Oracle upload
 */
export async function scanForSecrets(
  repoPath: string,
  files: string[]
): Promise<SecretScanResult> {
  const issues: SecretIssue[] = [];

  for (const file of files) {
    const fileName = basename(file);

    // Check if file name is dangerous
    if (isDangerousFile(file)) {
      issues.push({
        file,
        line: 0,
        type: 'sensitive_file',
        snippet: `File "${fileName}" should never be uploaded`,
      });
      continue;
    }

    // Scan file content
    try {
      const content = await readFile(join(repoPath, file), 'utf-8');
      const fileIssues = scanContent(file, content);
      issues.push(...fileIssues);
    } catch {
      // Skip unreadable files
    }
  }

  return {
    safe: issues.length === 0,
    issues,
  };
}

/**
 * Check if a file is inherently dangerous to upload
 */
export function isDangerousFile(filePath: string): boolean {
  const fileName = basename(filePath).toLowerCase();

  // Check exact matches
  if (DANGEROUS_FILES.has(fileName)) return true;

  // Check patterns
  if (fileName.startsWith('.env')) return true;
  if (fileName.endsWith('.pem')) return true;
  if (fileName.endsWith('.key')) return true;
  if (fileName.includes('credentials')) return true;
  if (fileName.includes('secrets')) return true;

  return false;
}

/**
 * Scan content for secret patterns
 */
function scanContent(file: string, content: string): SecretIssue[] {
  const issues: SecretIssue[] = [];
  const lines = content.split('\n');

  // Skip if looks like example/template
  if (isExampleFile(file, content)) {
    return [];
  }

  for (const { pattern, type } of SECRET_PATTERNS) {
    // Reset regex state
    pattern.lastIndex = 0;

    let match;
    while ((match = pattern.exec(content)) !== null) {
      // Find line number
      const beforeMatch = content.substring(0, match.index);
      const lineNum = beforeMatch.split('\n').length;

      // Skip if in comment (basic check)
      const line = lines[lineNum - 1] || '';
      if (isInComment(line, match[0])) continue;

      // Skip if looks like placeholder
      if (isPlaceholder(match[0])) continue;

      issues.push({
        file,
        line: lineNum,
        type,
        snippet: maskSecret(line.trim()),
      });
    }
  }

  return issues;
}

/**
 * Check if file is an example/template that shouldn't trigger warnings
 */
function isExampleFile(file: string, content: string): boolean {
  const lowerFile = file.toLowerCase();

  // Example file names
  if (lowerFile.includes('.example')) return true;
  if (lowerFile.includes('.template')) return true;
  if (lowerFile.includes('.sample')) return true;
  if (lowerFile.endsWith('.md')) return true;  // Documentation

  // Check content for example indicators
  if (content.includes('your-api-key-here')) return true;
  if (content.includes('YOUR_API_KEY')) return true;
  if (content.includes('xxx')) return true;

  return false;
}

/**
 * Basic check if match is inside a comment
 */
function isInComment(line: string, _match: string): boolean {
  const trimmed = line.trim();
  if (trimmed.startsWith('//')) return true;
  if (trimmed.startsWith('#')) return true;
  if (trimmed.startsWith('*')) return true;
  if (trimmed.startsWith('/*')) return true;

  return false;
}

/**
 * Check if value looks like a placeholder
 */
function isPlaceholder(value: string): boolean {
  const lower = value.toLowerCase();

  const placeholders = [
    'your-',
    'xxx',
    'placeholder',
    'example',
    'changeme',
    'replace-',
    'todo',
    'fixme',
    '<your',
    '${',
    '{{',
  ];

  return placeholders.some(p => lower.includes(p));
}

/**
 * Mask secrets in snippet for safe logging
 */
function maskSecret(line: string): string {
  // Mask anything that looks like a secret value
  return line.replace(
    /(['"])[a-zA-Z0-9_\-/.+=]{16,}\1/g,
    '$1***MASKED***$1'
  ).replace(
    /[:=]\s*[a-zA-Z0-9_\-/.+=]{20,}/g,
    ': ***MASKED***'
  );
}

/**
 * Format scan results for display
 */
export function formatScanResults(result: SecretScanResult): string {
  if (result.safe) {
    return '✓ No secrets detected';
  }

  const lines = ['⚠ Potential secrets detected:\n'];

  for (const issue of result.issues) {
    lines.push(`  ${issue.file}:${issue.line}`);
    lines.push(`    Type: ${issue.type}`);
    lines.push(`    ${issue.snippet}`);
    lines.push('');
  }

  lines.push('These files will be excluded from Oracle upload.');

  return lines.join('\n');
}
