import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './test', testMatch: '**/browser.spec.js', workers: 1, timeout: 60_000,
  reporter: 'list', use: {
    trace: 'retain-on-failure', screenshot: 'only-on-failure',
    ...(process.env.CHROMIUM_EXECUTABLE ? { launchOptions: { executablePath: process.env.CHROMIUM_EXECUTABLE, args: ['--no-sandbox','--disable-dev-shm-usage'] } } : {}),
  },
  projects: [
    { name: 'Handy', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
    { name: 'Desktop', use: { viewport: { width: 1440, height: 1000 } } },
  ],
});
