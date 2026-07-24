import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/playwright/src',
  outputDir: './tests/output/',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: 1,
  reporter: [
    ['list'],
    ['junit', { outputFile: './tests/output/junit-results.xml' }],
    ['json', { outputFile: './tests/output/json-results.json' }],
    ['html', { open: 'never', outputFolder: './tests/output/html-results/' }],
  ],
  use: {
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
