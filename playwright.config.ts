import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/playwright/src',
  outputDir: './tests/playwright/output/',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: 1,
  reporter: [
    ['list'],
    ['junit', { outputFile: './tests/playwright/output/junit-results.xml' }],
    ['json', { outputFile: './tests/playwright/output/json-results.json' }],
    ['html', { open: 'never', outputFolder: './tests/playwright/output/html-results/' }],
  ],
  use: {
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
