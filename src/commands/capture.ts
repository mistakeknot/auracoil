/**
 * Capture Command
 *
 * Capture a solved problem (template-based, no LLM required).
 * This is offline - useful for building institutional knowledge.
 */

import { mkdir, writeFile, readFile } from 'fs/promises';
import { join } from 'path';
import chalk from 'chalk';
import yaml from 'js-yaml';
import * as readline from 'readline';

interface CaptureOptions {
  category?: string;
  title?: string;
}

const CATEGORIES = [
  'bug-fix',
  'performance',
  'security',
  'refactoring',
  'integration',
  'testing',
  'deployment',
  'tooling',
  'documentation',
  'other',
];

const SOLUTION_TEMPLATE = `---
title: "{{TITLE}}"
category: {{CATEGORY}}
tags: []
symptoms: []
created: {{DATE}}
---

# {{TITLE}}

## Problem

[Describe the problem you encountered]

## Symptoms

- [What did you observe?]
- [Error messages?]

## Root Cause

[What was actually wrong?]

## Solution

[How did you fix it?]

\`\`\`typescript
// Code snippet if applicable
\`\`\`

## Verification

[How did you verify the fix worked?]

## Prevention

[How can this be prevented in the future?]

## Related

- [Links to related issues, PRs, or documentation]
`;

export async function captureCommand(options: CaptureOptions): Promise<void> {
  const cwd = process.cwd();
  const auracoilDir = join(cwd, '.auracoil');

  console.log(chalk.cyan('\n  Capture Solved Problem\n'));

  // Get category
  let category = options.category;
  if (!category || !CATEGORIES.includes(category)) {
    category = await promptChoice(
      'Category:',
      CATEGORIES.map(c => ({ label: c, value: c }))
    );
  }
  console.log(chalk.dim(`  Category: ${category}`));

  // Get title
  let title = options.title;
  if (!title) {
    title = await promptInput('Title (short description):');
  }
  console.log(chalk.dim(`  Title: ${title}`));

  // Generate slug
  const slug = slugify(title);
  const date = new Date().toISOString().split('T')[0];

  // Create solution file
  const solutionsDir = join(auracoilDir, 'solutions', category);
  await mkdir(solutionsDir, { recursive: true });

  const filePath = join(solutionsDir, `${date}-${slug}.md`);

  const content = SOLUTION_TEMPLATE
    .replace(/{{TITLE}}/g, title)
    .replace(/{{CATEGORY}}/g, category)
    .replace(/{{DATE}}/g, date);

  await writeFile(filePath, content);

  console.log(chalk.green(`\n  ✓ Created ${filePath}`));
  console.log(chalk.dim('\n  Next steps:'));
  console.log(chalk.dim(`    1. Edit the file to fill in details`));
  console.log(chalk.dim(`    2. Add tags and symptoms for searchability`));
  console.log(chalk.dim(`    3. Run \`auracoil search\` to verify it's findable\n`));
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
}

async function promptInput(prompt: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`  ${prompt} `, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function promptChoice(
  prompt: string,
  choices: Array<{ label: string; value: string }>
): Promise<string> {
  console.log(`  ${prompt}`);
  choices.forEach((c, i) => {
    console.log(chalk.dim(`    ${i + 1}. ${c.label}`));
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question('  Select number: ', (answer) => {
      rl.close();
      const idx = parseInt(answer, 10) - 1;
      if (idx >= 0 && idx < choices.length) {
        resolve(choices[idx].value);
      } else {
        resolve(choices[0].value);
      }
    });
  });
}
