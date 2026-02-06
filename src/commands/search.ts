/**
 * Search Command
 *
 * Search captured solutions using ripgrep.
 * No LLM required - fast local search.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { access, readFile, readdir } from 'fs/promises';
import { join, relative } from 'path';
import chalk from 'chalk';
import yaml from 'js-yaml';

const execFileAsync = promisify(execFile);

interface SearchOptions {
  category?: string;
}

interface Solution {
  path: string;
  title: string;
  category: string;
  tags: string[];
  symptoms: string[];
  created: string;
  matchedLines: string[];
  score: number;
}

export async function searchCommand(query: string, options: SearchOptions): Promise<void> {
  const cwd = process.cwd();
  const solutionsDir = join(cwd, '.auracoil/solutions');

  console.log(chalk.cyan(`\n  Searching for: "${query}"\n`));

  // Check if solutions directory exists
  try {
    await access(solutionsDir);
  } catch {
    console.log(chalk.yellow('  No solutions captured yet'));
    console.log(chalk.dim('  Run `auracoil capture` to add your first solution\n'));
    return;
  }

  // Try ripgrep first (fast), fall back to built-in search
  let results: Solution[];
  try {
    results = await searchWithRipgrep(solutionsDir, query, options);
  } catch {
    results = await searchBuiltIn(solutionsDir, query, options);
  }

  if (results.length === 0) {
    console.log(chalk.yellow('  No matching solutions found'));
    console.log(chalk.dim('\n  Tips:'));
    console.log(chalk.dim('    - Try broader search terms'));
    console.log(chalk.dim('    - Search by symptoms or error messages'));
    console.log(chalk.dim('    - Check spelling\n'));
    return;
  }

  // Display results
  console.log(chalk.dim(`  Found ${results.length} solution(s):\n`));

  for (const result of results.slice(0, 10)) {
    const relPath = relative(cwd, result.path);

    console.log(chalk.green(`  ${result.title}`));
    console.log(chalk.dim(`    Category: ${result.category}`));
    if (result.tags.length > 0) {
      console.log(chalk.dim(`    Tags: ${result.tags.join(', ')}`));
    }
    console.log(chalk.dim(`    File: ${relPath}`));

    // Show matched lines
    if (result.matchedLines.length > 0) {
      console.log(chalk.dim('    Matches:'));
      for (const line of result.matchedLines.slice(0, 3)) {
        console.log(chalk.dim(`      ${line.trim()}`));
      }
    }
    console.log('');
  }

  if (results.length > 10) {
    console.log(chalk.dim(`  ... and ${results.length - 10} more results\n`));
  }
}

async function searchWithRipgrep(
  solutionsDir: string,
  query: string,
  options: SearchOptions
): Promise<Solution[]> {
  const args = [
    '--json',
    '-i',  // case insensitive
    '-l',  // files only
    query,
    solutionsDir,
  ];

  const { stdout } = await execFileAsync('rg', args);

  const files = stdout.trim().split('\n').filter(Boolean);
  const results: Solution[] = [];

  for (const file of files) {
    const solution = await parseSolutionFile(file);
    if (solution) {
      if (options.category && solution.category !== options.category) {
        continue;
      }

      // Get matched lines
      const matchedLines = await getMatchedLines(file, query);
      solution.matchedLines = matchedLines;
      solution.score = calculateScore(solution, query);
      results.push(solution);
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

async function searchBuiltIn(
  solutionsDir: string,
  query: string,
  options: SearchOptions
): Promise<Solution[]> {
  const results: Solution[] = [];
  const queryLower = query.toLowerCase();

  // Recursively find all .md files
  const files = await findMarkdownFiles(solutionsDir);

  for (const file of files) {
    const content = await readFile(file, 'utf-8');

    if (!content.toLowerCase().includes(queryLower)) {
      continue;
    }

    const solution = await parseSolutionFile(file);
    if (solution) {
      if (options.category && solution.category !== options.category) {
        continue;
      }

      // Find matched lines
      const lines = content.split('\n');
      solution.matchedLines = lines.filter(l =>
        l.toLowerCase().includes(queryLower)
      );
      solution.score = calculateScore(solution, query);
      results.push(solution);
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

async function findMarkdownFiles(dir: string): Promise<string[]> {
  const files: string[] = [];

  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findMarkdownFiles(fullPath));
    } else if (entry.name.endsWith('.md')) {
      files.push(fullPath);
    }
  }

  return files;
}

async function parseSolutionFile(filePath: string): Promise<Solution | null> {
  try {
    const content = await readFile(filePath, 'utf-8');

    // Extract frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) {
      return null;
    }

    const frontmatter = yaml.load(frontmatterMatch[1]) as Record<string, unknown>;

    return {
      path: filePath,
      title: String(frontmatter.title || 'Untitled'),
      category: String(frontmatter.category || 'other'),
      tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : [],
      symptoms: Array.isArray(frontmatter.symptoms) ? frontmatter.symptoms : [],
      created: String(frontmatter.created || ''),
      matchedLines: [],
      score: 0,
    };
  } catch {
    return null;
  }
}

async function getMatchedLines(filePath: string, query: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('rg', [
      '-i',
      '--no-line-number',
      query,
      filePath,
    ]);
    return stdout.trim().split('\n').slice(0, 5);
  } catch {
    return [];
  }
}

function calculateScore(solution: Solution, query: string): number {
  const queryLower = query.toLowerCase();
  let score = 0;

  // Title match (highest weight)
  if (solution.title.toLowerCase().includes(queryLower)) {
    score += 100;
  }

  // Tag match
  if (solution.tags.some(t => t.toLowerCase().includes(queryLower))) {
    score += 50;
  }

  // Symptom match
  if (solution.symptoms.some(s => s.toLowerCase().includes(queryLower))) {
    score += 30;
  }

  // More matched lines = higher relevance
  score += solution.matchedLines.length * 5;

  // Recency bonus (newer = higher)
  if (solution.created) {
    const age = Date.now() - new Date(solution.created).getTime();
    const daysOld = age / (1000 * 60 * 60 * 24);
    if (daysOld < 30) score += 20;
    else if (daysOld < 90) score += 10;
  }

  return score;
}
