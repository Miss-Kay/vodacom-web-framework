import { Page, expect, test } from '@playwright/test';
import { BasePage } from './BasePage';
import { healing, firstVisible } from '../utils/selfHealing';
import { site } from '../fixtures/siteProfile';

/**
 * Build Your Own Contract — the builder proper at /shop/deal-builder.
 *
 * The whole flow keeps its state in the query string:
 *   ?connection=mobile&type=device&contract=new&step=plan&device=100021503
 * so each step is addressable, assertable, and deep-linkable. Every step
 * assertion below reads that URL rather than guessing from the DOM.
 *
 * Two structural facts drive the locators here:
 *
 *  1. Device cards are <div class="product-card cursor-pointer">, not links.
 *     There is no href to follow and no role to query — only the card's own
 *     click handler. Playwright's real mouse events drive them correctly.
 *
 *  2. The advancing CTA is rendered TWICE — once in the desktop summary
 *     sidebar and once in a fixed bottom bar for mobile. Clicking "the"
 *     Next button therefore has to pick the visible one, which is what
 *     SelfHealingLocator.resolve() does anyway: it returns the first
 *     candidate that is actually visible.
 */
export class DealBuilderPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  // ---------------------------------------------------------------- steps

  async assertOnDeviceStep(): Promise<void> {
    await this.expectUrlContains(site.dealBuilder.deviceStepPattern);
    await expect(
      this.page.getByRole('heading', { name: /choose your device/i }).first(),
    ).toBeVisible({ timeout: 30_000 });
    await this.checkpointReached('03-device-step');
  }

  async assertOnPlanStep(): Promise<void> {
    await this.expectUrlContains(site.dealBuilder.planStepPattern);
    await expect(
      this.page.getByRole('heading', { name: /choose your plan/i }).first(),
    ).toBeVisible({ timeout: 30_000 });
    await this.checkpointReached('05-plan-step');
  }

  async assertOnAddOnStep(): Promise<void> {
    await this.expectUrlContains(site.dealBuilder.addOnStepPattern);
    await this.checkpointReached('06-addon-step');
  }

  // --------------------------------------------------------------- device

  /** A device card on the device step, addressed by its title. */
  private deviceCard(name: string) {
    const title = new RegExp(escapeRegExp(name), 'i');
    return healing(this.page, `"${name}" device card`, [
      { name: 'product-card', build: p => p.locator('.product-card').filter({ hasText: title }) },
      {
        name: 'clickable card',
        build: p => p.locator('[class*="cursor-pointer"]').filter({ hasText: title }),
      },
      { name: 'slide', build: p => p.locator('.embla__slide').filter({ hasText: title }) },
    ]);
  }

  /**
   * Select a device and prove the choice reached the URL.
   *
   * The SKU assertion is the point: the card is a div with a click handler,
   * so "the click worked" cannot be inferred from a navigation. If the
   * handler silently fails the page looks identical, and only the absent
   * device= parameter gives it away.
   */
  async selectDevice(name: string, expectedSku: string): Promise<void> {
    const card = await this.deviceCard(name).resolve();
    await card.scrollIntoViewIfNeeded();
    await card.click();
    await this.expectUrlContains(new RegExp(`[?&]device=${escapeRegExp(expectedSku)}\\b`, 'i'));
    console.info(`[FUNNEL] device selected: ${name} (sku ${expectedSku})`);
    await this.checkpointReached('04-device-selected');
  }

  /** How many devices the step offers before "Browse all devices". */
  async devicesOffered(): Promise<number> {
    return this.page.locator('.product-card').count();
  }

  /**
   * Assert the device step actually offers devices. Same race as the plan
   * step — see countWhenRendered — so the count is waited for rather than
   * taken at first paint.
   */
  async assertDevicesOffered(minimum = 1): Promise<number> {
    const offered = await this.countWhenRendered('devices', () => this.devicesOffered());
    expect(
      offered,
      `The device step offered ${offered} devices. A customer cannot start a `
        + 'contract without one, so the funnel ends here.',
    ).toBeGreaterThanOrEqual(minimum);
    console.info(`[FUNNEL] device step offered ${offered} devices`);
    return offered;
  }

  // ----------------------------------------------------------- navigation

  /**
   * The advancing CTA.
   *
   * Two traps here, both found by running this against the real page:
   *
   *  1. The label is written per step — "Next: Choose a device",
   *     "Next: Choose my plan", and so on. Matching the exact word "Next"
   *     finds nothing, which is why this matches on a prefix.
   *
   *  2. There are also two plain "Next" buttons on every step, one in the
   *     desktop summary sidebar and one in a fixed mobile bar, and BOTH
   *     render 0x0 on the device step. They are in the DOM, they are
   *     clickable as far as a naive selector is concerned, and clicking
   *     them does nothing. resolve() returns the first candidate that is
   *     actually VISIBLE, which is what steps past them.
   */
  private nextButton(label: RegExp = /next/i) {
    return healing(this.page, 'advancing CTA', [
      { name: 'button by text', build: p => p.locator('button').filter({ hasText: label }) },
      { name: 'role=button', build: p => p.getByRole('button', { name: label }) },
      {
        name: 'clickable element by text',
        build: p => p.locator('[class*="cursor-pointer"]').filter({ hasText: label }),
      },
    ]);
  }

  /**
   * Advance one step.
   *
   * Between device and plan the shop interrupts with a "Get a Double Deal!"
   * upsell modal — an extra decision inserted at the highest-momentum moment
   * in the funnel. It is not an error and it is not optional, so the journey
   * has to handle it. We decline it (keep one device) and carry on, and we
   * report that it fired so the run records the interruption.
   */
  async advance(): Promise<void> {
    const next = await this.nextButton().resolve();
    await next.scrollIntoViewIfNeeded();
    await next.click();
    await this.dismissDoubleDealUpsell();
  }

  /** Returns true when the upsell interstitial appeared and was declined. */
  async dismissDoubleDealUpsell(): Promise<boolean> {
    const continueCta = this.page
      .locator('button, [class*="cursor-pointer"]')
      .filter({ hasText: /continue to plans/i })
      .first();

    const appeared = await continueCta
      .waitFor({ state: 'visible', timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    if (!appeared) return false;

    console.info('[FUNNEL] "Get a Double Deal!" upsell interrupted the flow — declining');
    await test.info().attach('upsell-interruption.txt', {
      body:
        'A "Get a Double Deal!" modal was shown between the device and plan '
        + 'steps. The journey declined it (kept one device) and continued.',
      contentType: 'text/plain',
    });
    await continueCta.click();
    return true;
  }

  // ----------------------------------------------------------------- plan

  /**
   * The plan step's two tabs. "Our top picks" is the default and is meant to
   * carry recommended plans for the chosen device; "Build my own plan" is
   * the manual configurator behind it.
   */
  private planTab(label: string) {
    // Unanchored: these buttons carry icon text alongside their label, so an
    // anchored ^...$ match finds nothing. Same trap as the advancing CTA.
    const name = new RegExp(escapeRegExp(label), 'i');
    return healing(this.page, `"${label}" tab`, [
      { name: 'button by text', build: p => p.locator('button').filter({ hasText: name }) },
      { name: 'role=tab', build: p => p.getByRole('tab', { name }) },
    ]);
  }

  async openPlanTab(label: string): Promise<void> {
    await (await this.planTab(label).resolve()).click();
  }

  /**
   * Count the plans actually offered to the customer on the current tab.
   *
   * "Rendered" is not the same as "offered", and that gap is the whole
   * reason this method exists rather than a plain locator.count(). The
   * recommended rail mounts five plan-card skeletons and, when the data
   * never arrives, leaves them mounted: present in the DOM, zero height,
   * empty text. Counting nodes would report five healthy plans on a screen
   * showing nothing. So a plan counts only if it is visible AND has text.
   */
  /**
   * Count something the builder fetches, once it has actually arrived.
   *
   * Every step here renders its heading and its step chrome from static
   * markup, and then fills the cards from a GraphQL round-trip — the config
   * calls this "a slow SPA: several GraphQL round-trips per step" and gives
   * it a 180s test timeout for that reason. Counting the instant the heading
   * becomes visible therefore races the fetch.
   *
   * That race is why this suite spent a week reporting an empty funnel that
   * was not empty. It passed from Johannesburg, next to the origin, and
   * failed from a GitHub runner far from it — which reads exactly like a
   * geographic defect in the shop and is really just latency. A zero that
   * has not been waited for says nothing.
   *
   * So a zero is only believed after the deadline. A non-zero count is
   * returned as soon as it appears, so the healthy path costs nothing.
   */
  private async countWhenRendered(
    label: string,
    count: () => Promise<number>,
    timeoutMs = 45_000,
  ): Promise<number> {
    const deadline = Date.now() + timeoutMs;
    let current = await count();
    while (current === 0 && Date.now() < deadline) {
      await this.page.waitForTimeout(500);
      current = await count();
    }
    if (current === 0) {
      console.warn(`[FUNNEL] no ${label} rendered after waiting ${timeoutMs}ms`);
    }
    return current;
  }

  async plansOffered(): Promise<number> {
    const cards = this.page.locator('[class*="plan-card"], [class*="planCard"]');
    const total = await cards.count();
    let real = 0;
    for (let index = 0; index < total; index += 1) {
      const card = cards.nth(index);
      const visible = await card.isVisible().catch(() => false);
      if (!visible) continue;
      const text = ((await card.textContent().catch(() => '')) ?? '').trim();
      if (text.length > 0) real += 1;
    }
    if (total !== real) {
      console.warn(
        `[PLANS] ${total} plan card(s) in the DOM but only ${real} rendered content — `
          + `${total - real} unfilled skeleton(s)`,
      );
    }
    return real;
  }

  /**
   * Assert the plan step actually offers plans.
   *
   * This is the assertion the whole suite is built around: it is the point
   * where the funnel currently dies in production. See the @known-defect
   * test in tests/byoc-journey.spec.ts.
   */
  async assertPlansOffered(minimum: number): Promise<void> {
    const offered = await this.countWhenRendered('plans', () => this.plansOffered());
    await test.info().attach('plans-offered.txt', {
      body:
        `"Our top picks" rendered ${offered} selectable plan(s); minimum expected ${minimum}. `
        + 'Counted after waiting for the step\'s GraphQL fetch, not at first paint.',
      contentType: 'text/plain',
    });
    expect(
      offered,
      `The plan step offered ${offered} plans. A customer who has chosen a device `
        + 'cannot continue without one, so the funnel ends here.',
    ).toBeGreaterThanOrEqual(minimum);
  }

  /**
   * True when the manual configurator behind the second tab still works.
   *
   * Keyed on the plan-type OPTIONS, not on the heading above them. The
   * heading is written differently per breakpoint — "Choose your plan type"
   * on mobile, "What kind of plan are your looking for?" on desktop (their
   * typo, live) — so a heading match passes on one project and fails on the
   * other for no reason a reader could guess. The options are the thing the
   * customer has to be able to use, and they are identical either way.
   */
  async buildMyOwnPlanIsUsable(): Promise<boolean> {
    await this.openPlanTab('Build my own plan');
    const option = await firstVisible(this.page, this.page.getByText(/data & voice minutes/i), 20_000);
    return option !== null;
  }

  // -------------------------------------------------------------- add-ons

  /** Options offered on the add-ons step, counted the same careful way. */
  async addOnsOffered(): Promise<number> {
    const options = this.page.locator(
      '[class*="addon"], [class*="add-on"], [class*="product-card"]',
    );
    const total = await options.count();
    let real = 0;
    for (let index = 0; index < total; index += 1) {
      const option = options.nth(index);
      if (!(await option.isVisible().catch(() => false))) continue;
      const text = ((await option.textContent().catch(() => '')) ?? '').trim();
      if (text.length > 0) real += 1;
    }
    return real;
  }

  /** Open the summary drawer and read the contract back. */
  async openReview(): Promise<void> {
    await (await this.nextButton(/review/i).resolve()).click();
    await expect(this.page.getByText(/your contract/i).first()).toBeVisible({ timeout: 30_000 });
    await this.checkpointReached('07-review-summary');
  }

  /** The monthly total the summary quotes, as a number. */
  async monthlyTotal(): Promise<number> {
    const text = await this.page
      .getByText(new RegExp(`${site.currencySymbol}\\s?[\\d,]+`))
      .first()
      .textContent();
    return Number((text ?? '').replace(/[^\d]/g, ''));
  }

  /**
   * Cross from the builder into checkout. Stops at the application gate.
   *
   * Presses whichever forward CTA is on screen and repeats, rather than
   * naming a sequence of buttons. The two breakpoints route differently —
   * desktop offers a single "Start application", mobile goes "Review" and
   * then "Apply now" — and hard-coding either sequence produces a test that
   * only works on one of them. Looping on "whatever moves the customer
   * forward" is both breakpoint-agnostic and a truer description of what a
   * customer does.
   */
  async proceedToCheckout(maxSteps = 4): Promise<boolean> {
    const forward = /apply now|start application|review|continue to checkout/i;

    for (let step = 0; step < maxSteps; step += 1) {
      if (site.checkoutUrlPattern.test(this.page.url())) return true;

      const cta = await firstVisible(
        this.page,
        this.page.locator('button, a').filter({ hasText: forward }),
        10_000,
      );
      if (!cta) break;

      const label = ((await cta.textContent()) ?? '').replace(/\s+/g, ' ').trim();
      console.info(`[FUNNEL] pressing "${label}" to move toward checkout`);
      await cta.scrollIntoViewIfNeeded();

      // Bounded, with a fallback. This shop stacks summary drawers and
      // modals over its own CTAs, so a button can be visible, enabled, and
      // still never pass Playwright's actionability check — leaving an
      // unbounded click() to burn the entire test timeout on one button.
      // 15s is long enough for a real animation to settle; past that, the
      // obstruction is not going to clear, and a dispatched click tells us
      // whether the handler works even though the element is covered.
      try {
        await cta.click({ timeout: 15_000 });
      } catch {
        console.warn(`[FUNNEL] "${label}" was covered — dispatching the click directly`);
        await cta.dispatchEvent('click');
      }
      await this.page.waitForTimeout(5000);
    }

    return site.checkoutUrlPattern.test(this.page.url());
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
