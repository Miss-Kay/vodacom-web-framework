import { defineConfig, devices } from '@playwright/test';
import { site } from './fixtures/siteProfile';

/**
 * BASE_URL is env-driven so the same framework runs against:
 *  - the site profile's production URL (local, headed, exploratory runs)
 *  - a staging environment                (CI — if production ever blocks bots)
 */
export default defineConfig({
  testDir: './tests',
  timeout: 180_000, // the deal builder is a slow SPA: several GraphQL round-trips per step
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['junit', { outputFile: 'test-results/junit.xml' }], // Jira/Xray-importable
  ],
  use: {
    baseURL: process.env.BASE_URL || site.baseUrl, // empty/unset → site profile
    trace: 'retain-on-failure',
    screenshot: 'on',
    video: 'retain-on-failure',
    locale: site.locale,
  },
  /**
   * Two projects, not one.
   *
   * Vodacom's South African traffic is overwhelmingly mobile, and the shop
   * behaves differently at 375px — the deal builder's advancing CTA moves
   * into a fixed bottom bar, and the landing accordion reveals each step far
   * below the fold. A desktop-only suite would never see either. The mobile
   * project is therefore a first-class run, not an afterthought.
   */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
    },
  ],
});
