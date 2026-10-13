import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import { dirname, join } from 'node:path';
import process from 'node:process';

const root = fileURLToPath(new URL('../', import.meta.url));
const checks = [
  ['Frontend tests', 'vitest/vitest.mjs', ['run']],
  ['TypeScript', 'typescript/bin/tsc', ['--noEmit']],
  [
    'Lint',
    'eslint/bin/eslint.js',
    [
      'apps/student/src',
      'apps/student/build',
      'shared',
      'apps/student/vite.config.ts',
      'vitest.config.ts',
      'playwright.config.ts',
      'e2e',
      'scripts',
      'teacher/static/studio.js',
      '--max-warnings',
      '0',
    ],
  ],
  ['Production build', 'vite/bin/vite.js', ['build', '--config', 'apps/student/vite.config.ts']],
  ['Browser tests', '@playwright/test/cli.js', ['test']],
];
for (const [name, cli, args] of checks) {
  process.stdout.write(`\n> ${name}\n`);
  const result = spawnSync(process.execPath, [join(root, 'node_modules', cli), ...args], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      PATH: `${dirname(process.execPath)}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`,
    },
  });
  if (result.error) {
    process.stderr.write(result.error.message + '\n');
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
