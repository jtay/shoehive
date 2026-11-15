import { defineConfig, devices } from '@playwright/test';

// End-to-end tests for the browser examples (RFC 0001, Phase 3). Each example builds its
// web app and serves it, with its Shoehive server, on its own port.
const CI = Boolean(process.env['CI']);
const examples = [
  { name: 'tic-tac-toe', port: 3101 },
  { name: 'quiz', port: 3102 },
] as const;

export default defineConfig({
  timeout: 30_000,
  expect: { timeout: 5_000 },
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [['list'], ['github']] : 'list',
  outputDir: 'test-results',
  projects: examples.map(({ name, port }) => ({
    name,
    testDir: `examples/${name}/e2e`,
    use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${String(port)}` },
  })),
  webServer: examples.map(({ name, port }) => ({
    command: `pnpm --filter @shoehive-examples/${name} build:web && pnpm --filter @shoehive-examples/${name} start`,
    url: `http://localhost:${String(port)}`,
    env: { PORT: String(port) },
    reuseExistingServer: !CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  })),
});
