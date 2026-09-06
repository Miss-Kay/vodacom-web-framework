import { Page, expect, test } from '@playwright/test';
import { site } from '../fixtures/siteProfile';

/**
 * BasePage: shared plumbing for every page object.
 * Keep this thin — if it grows past ~90 lines, something belongs elsewhere.
 */
export abstract class BasePage {
  constructor(protected page: Page) {}

  async open(path = '/'): Promise<void> {
    await this.page.goto(path, { waitUntil: 'domcontentloaded' });
    await this.dismissCookieBanner();
  }

  /**
   * Cookie/consent banners are the #1 cause of flaky journey tests, and
   * Vodacom's is worse than most: OneTrust is configured here as a modal
   * consent wall, so alongside the banner it renders a
   * `.onetrust-pc-dark-filter` covering the full viewport at z-index
   * 2147483645. Until it is dismissed, every click on the page underneath
   * hits the filter instead.
   *
   * We dismiss it with the least-permissive control available (reject) and
   * only fall back to "accept all" if the banner offers nothing else, so the
   * run doesn't opt into more tracking than a privacy-conscious customer
   * would.
   *
   * Wait on #onetrust-banner-sdk, NOT the #onetrust-consent-sdk wrapper.
   * The wrapper renders 1440x0 — full width, zero height — so Playwright
   * correctly reports it as not visible, and a presence check against it
   * concludes "no banner was served" while the banner is plainly on screen.
   * That early return is what silently left the dark filter up, and the
   * accordion clicks that followed all failed on an intercepted pointer.
   */
  protected async dismissCookieBanner(): Promise<void> {
    const banner = this.page.locator('#onetrust-banner-sdk');
    const darkFilter = this.page.locator('.onetrust-pc-dark-filter');

    const bannerShown = await banner
      .waitFor({ state: 'visible', timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    if (!bannerShown) return; // no banner served — nothing to dismiss

    const candidates = [
      this.page.locator('#onetrust-reject-all-handler'),    // Reject All non-essential
      this.page.locator('.save-preference-btn-handler'),    // Confirm My Choices
      this.page.locator('#onetrust-accept-btn-handler'),    // Accept all Cookies
      this.page.locator('#accept-recommended-btn-handler'), // Allow All (pref centre)
    ];

    for (const candidate of candidates) {
      try {
        await candidate.first().click({ timeout: 3000 });
        // Both must go. The banner hiding is not enough on its own — the
        // dark filter is a separate element and is the one that intercepts.
        await banner.waitFor({ state: 'hidden', timeout: 8000 });
        await darkFilter.waitFor({ state: 'hidden', timeout: 8000 }).catch(() => {
          /* not every OneTrust build renders one */
        });
        return;
      } catch {
        /* try the next control */
      }
    }

    console.warn('[CONSENT] banner was shown but could not be dismissed');
  }

  /**
   * Drop-off instrumentation: screenshot at each funnel step, attached to
   * the test so it appears in the HTML report (and therefore on the S3
   * report site) instead of dying on the CI runner's disk.
   */
  async checkpointReached(stepName: string): Promise<void> {
    const screenshot = await this.page.screenshot({ fullPage: false });
    await test.info().attach(stepName, { body: screenshot, contentType: 'image/png' });
    console.info(`[FUNNEL] checkpoint reached: ${stepName}`);
  }

  async expectUrlContains(fragment: string | RegExp): Promise<void> {
    const pattern = typeof fragment === 'string' ? new RegExp(fragment, 'i') : fragment;
    // Deliberately toHaveURL and not waitForURL. waitForURL waits on the
    // navigation lifecycle, and the shop pulls in enough third-party
    // tracking (AppDynamics, OneTrust, ~29 analytics beacons per step) that
    // "load" may never settle on a CI runner. toHaveURL polls page.url(),
    // which is what we actually mean by "we are on this step".
    await expect(this.page).toHaveURL(pattern, { timeout: 45_000 });
  }

  /**
   * True when the site served its bot-protection interstitial instead of
   * the real page — common when the request comes from a datacenter IP
   * (CI runners). The block page is static and present at load, so a
   * no-wait visibility check is enough and costs nothing on a normal run.
   */
  async isBotBlocked(): Promise<boolean> {
    if (site.botBlockUrlPattern?.test(this.page.url())) return true;
    if (!site.botBlockPattern) return false; // site permits automation
    return this.page
      .getByText(site.botBlockPattern)
      .first()
      .isVisible()
      .catch(() => false);
  }

  /**
   * Scroll the full height of the page so lazy-loaded sections mount and
   * their content enters the DOM. Without this a check silently covers only
   * the part of the page that happened to be above the fold.
   */
  protected async scrollThroughPage(): Promise<void> {
    await this.page.evaluate(async () => {
      const step = window.innerHeight;
      for (let y = 0; y < document.body.scrollHeight; y += step) {
        window.scrollTo(0, y);
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      window.scrollTo(0, 0);
    });
    await this.page.waitForTimeout(1500);
  }
}
