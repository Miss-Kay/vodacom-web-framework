import { Page, expect } from '@playwright/test';
import { BasePage } from './BasePage';
import { firstVisible } from '../utils/selfHealing';

/**
 * A pre-packaged deal's product page, e.g. /shop/dv6hb00314.
 *
 * Note the URLs: products are addressed by raw SKU with no readable slug, so
 * neither a customer nor a search engine can tell what /shop/dv6hb00314 is
 * before opening it. The human name lives in fixtures/testData.ts instead.
 *
 * The interesting behaviour here is what the primary CTA does. A customer
 * who picks a ready-made deal has chosen NOT to configure anything — so
 * where "Get this deal" takes them is the question worth asserting on.
 */
export class DealPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  /**
   * Assert the right deal page rendered.
   *
   * Checked against the document title rather than the on-page heading. The
   * heading is real and correct, but a Double Deal's name is assembled from
   * several elements ("Apple iPhone 16 128GB 5G", " + ", "Apple iPhone 15
   * 128GB 5G"), and getByText matches an element's own text — so the full
   * name matches no single node and the assertion fails on a page that is
   * perfectly fine. The <title> carries the whole string in one piece.
   *
   * The title alone would pass on a page that returned its shell and
   * rendered nothing, so the CTA check below it does the real work of
   * proving the deal body mounted.
   */
  async assertLoaded(heading: RegExp): Promise<void> {
    await expect(this.page).toHaveTitle(heading, { timeout: 45_000 });
    const cta = await firstVisible(
      this.page,
      this.page.locator('button, a').filter({ hasText: /get this deal|add to cart/i }),
      45_000,
    );
    expect(cta, 'the deal page rendered no visible buy CTA').not.toBeNull();
    await this.checkpointReached('02-packaged-deal-page');
  }

  /**
   * The calls to action competing for the same click at the bottom of the
   * page. Reported so a growing list shows up in the run: three CTAs of
   * near-equal weight at the buy moment is already a choice-paralysis risk.
   */
  async callsToAction(): Promise<string[]> {
    const candidates = [/build my own deal/i, /continue to add extras/i, /get this deal/i];
    const present: string[] = [];
    for (const pattern of candidates) {
      // firstVisible, not .first() — each of these labels also exists in
      // off-screen copies on this page, and .first() reports the hidden one.
      const cta = await firstVisible(
        this.page,
        this.page.locator('button, a').filter({ hasText: pattern }),
        2000,
      );
      if (cta) present.push(pattern.source);
    }
    console.info(`[UX] ${present.length} competing CTAs on the deal page: ${present.join(', ')}`);
    return present;
  }

  /**
   * Press one of the page's calls to action.
   *
   * Unanchored match, and the first VISIBLE result. The anchored form found
   * nothing (these buttons carry icon text beside their label) and .first()
   * found a hidden copy, which produced the worst failure mode of the lot:
   * click() waiting out the full test timeout on an element that was never
   * going to become clickable.
   */
  async pressCta(label: string): Promise<void> {
    const cta = await firstVisible(
      this.page,
      this.page
        .locator('button, a, [class*="cursor-pointer"]')
        .filter({ hasText: new RegExp(escapeRegExp(label), 'i') }),
      20_000,
    );
    if (!cta) throw new Error(`No visible call to action matching "${label}" on ${this.page.url()}`);
    await cta.scrollIntoViewIfNeeded();
    await cta.click();
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
