// playwright.config.js
// Run: npx playwright test
// Run against prod: BASE_URL=https://mysurflife.com npx playwright test

const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,       // Copilot tests need the backend warm
  timeout: 90_000,            // Wave GRIB downloads can take 30s on first fetch
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',

  use: {
    baseURL:     process.env.BASE_URL || 'http://localhost:3000',
    trace:       'on-first-retry',
    screenshot:  'only-on-failure',
    video:       'off',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
