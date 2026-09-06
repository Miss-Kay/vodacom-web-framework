import { Page, expect } from '@playwright/test';
import { BasePage } from './BasePage';
import { healing } from '../utils/selfHealing';
import { PageLink, collectLinks, collectMalformedLinks } from '../utils/linkChecker';

/**
 * Vodacom shop home — /shop/. The launch point for every journey.
 *
 * Its header carries the primary nav (Mobile & Internet, Financial Services,
 * Lifestyle & Rewards) plus the account and cart controls. Note that the
 * journey a customer takes crosses application boundaries almost
 * immediately: the shop is Magento at /shop, login and account live in a
 * separate app at /cloud, and marketing content sits at /vodacom.
 */
export class ShopHomePage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  private navLink(label: string) {
    const name = new RegExp(`^\\s*${escapeRegExp(label)}\\s*$`, 'i');
    return healing(this.page, `"${label}" nav link`, [
      { name: 'header link', build: p => p.locator('header a').filter({ hasText: name }) },
      { name: 'role=link', build: p => p.getByRole('link', { name }) },
    ]);
  }

  /**
   * Assert the shop shell rendered.
   *
   * Not on <header>. Magento's `header.page-header` is a 1440x0 wrapper —
   * full width, no height — so toBeVisible() fails on it even though the
   * navigation inside is on screen. The cart link is a real, always-present
   * control inside that header, and it is what a customer would look for.
   */
  async assertLoaded(): Promise<void> {
    await expect(
      this.page.locator('a[href*="checkout/cart"]').first(),
    ).toBeVisible({ timeout: 30_000 });
    await this.checkpointReached('01-shop-home');
  }

  async openNav(label: string): Promise<void> {
    await this.navLink(label).click();
  }

  /** Every anchor on the page, deduped and resolved to absolute URLs. */
  async links(): Promise<PageLink[]> {
    // The page lazy-loads sections as they scroll into view, so links below
    // the fold do not exist in the DOM until we go looking for them.
    await this.scrollThroughPage();
    const links = await collectLinks(this.page);
    console.info(`[LINKS] collected ${links.length} unique links`);
    return links;
  }

  /** Hrefs that cannot be parsed as URLs at all — always a defect. */
  async malformedLinks(): Promise<string[]> {
    return collectMalformedLinks(this.page);
  }

  /** The cart badge, used to prove an add-to-cart actually happened. */
  async cartCount(): Promise<number> {
    const badge = this.page.locator('a[href*="checkout/cart"]').first();
    const text = (await badge.textContent().catch(() => '')) ?? '';
    const digits = text.replace(/[^\d]/g, '');
    return digits ? Number(digits) : 0;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
