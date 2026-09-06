import { test, expect } from '@playwright/test';
import { ShopHomePage } from '../pages/ShopHomePage';
import {
  collectContentLeaks,
  formatLeakReport,
  isCustomerFacing,
} from '../utils/contentIntegrity';
import { contentScanPages } from '../fixtures/testData';
import { site } from '../fixtures/siteProfile';

/**
 * CONTENT INTEGRITY — placeholder leaks in customer-facing copy.
 *
 * A link check proves the customer can get somewhere. This proves that what
 * they find when they arrive is finished.
 *
 * The failure it catches is the one a screenshot smoke test sails past: the
 * page renders, returns 200, every link resolves — and a heading reads
 * "undefined months". Nobody wrote an assertion for text that was never
 * supposed to exist, so it ships and stays shipped.
 *
 * Known live at the time of writing, inside the deal builder:
 *   <h3>undefined</h3>, "undefined  min", "undefined  months", "Add undefined"
 * and on the upgrade page, headings rendering a bare "-".
 *
 * Those all sit in elements that are hidden until the relevant step opens,
 * so the default sweep (visible only) is green while the audit run below
 * finds them. Both matter: the first is what customers hit today, the
 * second is what they hit as soon as they reach that step.
 */
test.describe(`${site.name} — content integrity`, () => {
  for (const scanned of contentScanPages) {
    test(`no placeholder text on ${scanned.name} @content @smoke`, async ({ page }) => {
      const shop = new ShopHomePage(page);
      await shop.open(scanned.path);
      test.skip(await shop.isBotBlocked(), 'bot-protection page served — skipping');

      // Lazy-loaded sections do not exist until scrolled into view.
      await page.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight) {
          window.scrollTo(0, y);
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(1500);

      const leaks = await collectContentLeaks(page);
      await test.info().attach('content-integrity.md', {
        body: formatLeakReport(scanned.name, page.url(), leaks),
        contentType: 'text/markdown',
      });

      const blocking = leaks.filter(isCustomerFacing);
      for (const leak of leaks) {
        console.info(
          `[CONTENT] ${isCustomerFacing(leak) ? 'BLOCKING' : 'reported'} `
            + `${leak.kind} in ${leak.role}: "${leak.text}" (${leak.selector})`,
        );
      }

      expect(
        blocking,
        `${blocking.length} placeholder(s) leaked into headings, buttons or labels on `
          + `${scanned.name}: ${blocking.map(l => `"${l.text}"`).join(', ')}`,
      ).toHaveLength(0);
    });
  }

  /**
   * The full-DOM audit, reported rather than failed.
   *
   * The deal builder renders every step and every modal into one document,
   * so most of its placeholders are hidden behind steps the customer has
   * not reached yet. They are latent, not live — failing on them would make
   * the suite noisy, and a noisy suite gets ignored. Reporting them means
   * the next person to open that step already knows what they will find.
   */
  test(`audit: placeholders hidden behind unopened steps @content @audit`, async ({ page }) => {
    const shop = new ShopHomePage(page);
    await shop.open(site.paths.dealBuilderLanding);
    test.skip(await shop.isBotBlocked(), 'bot-protection page served — skipping');
    await page.waitForTimeout(3000);

    const all = await collectContentLeaks(page, { includeHidden: true });
    const hidden = all.filter(leak => !leak.visible);

    await test.info().attach('content-audit.md', {
      body: formatLeakReport(
        'Build Your Own Contract (full DOM, including unopened steps)',
        page.url(),
        all,
      ),
      contentType: 'text/markdown',
    });

    console.info(
      `[CONTENT] audit: ${all.length} placeholder(s) in the DOM, `
        + `${hidden.length} behind steps the customer has not opened yet`,
    );
  });
});
