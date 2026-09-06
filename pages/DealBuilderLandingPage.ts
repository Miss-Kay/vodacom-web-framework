import { Page, expect } from '@playwright/test';
import { BasePage } from './BasePage';
import { healing } from '../utils/selfHealing';

/**
 * Build Your Own Contract — the landing page at /shop/deal-builder/landing.
 *
 * This page is a stacked accordion, not a wizard. Each answer reveals the
 * next question BELOW the current one and the page does not scroll to it, so
 * a customer on a phone taps a card and sees nothing change. Four questions
 * stand between the landing page and the first handset.
 *
 * The options are <button> elements with no accessible name — the label sits
 * in a nested div — so getByRole('button', { name }) does not find them.
 * That is why every locator chain here starts with a text filter rather than
 * a role, the reverse of the usual preference order.
 */
export class DealBuilderLandingPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  /**
   * An accordion option, addressed by its visible label.
   *
   * The three questions are not built the same way, which is why this chain
   * exists rather than a single selector:
   *
   *   Q1 ("Mobile contract" / "Internet contract")
   *     a real <button> carrying a title and a subtitle.
   *
   *   Q2 and Q3 ("With a device", "Get a new contract", …)
   *     cards inside an Embla carousel — <div class="embla__slide"> whose
   *     title is a <span class="contract-option-title">. No button, no role,
   *     no href; only the card's own click handler.
   *
   * The hasNotText guard on the button candidate is load-bearing. Once Q1 is
   * answered the page also renders a TAB STRIP whose buttons carry the very
   * same labels ("Mobile contract" | "Internet contract"), and a plain
   * hasText match binds to the tab instead of the card. Clicking the tab
   * looks like it worked and advances nothing. The card's text is
   * "Mobile contract Build a mobile contract with…", the tab's is exactly
   * "Mobile contract" — so excluding an exact whole-text match keeps the
   * card and drops the tab.
   */
  private option(label: string) {
    const escaped = escapeRegExp(label);
    const contains = new RegExp(escaped, 'i');
    const exactly = new RegExp(`^\\s*${escaped}\\s*$`, 'i');

    return healing(this.page, `"${label}" option`, [
      {
        // Both option widgets, each matched PRECISELY, combined with or().
        //
        // Precision is the whole point. A loose union like
        // `.embla__slide, button` filtered on text also matches the tab
        // strip that appears once a question is answered — tabs carrying
        // exactly the same labels ("With a device" | "SIM only"). The tab
        // is visible and comes first in DOM order, so a loose selector
        // clicks it, the click does nothing, and the next question never
        // reveals. That failure is silent: the run reports choosing the
        // option it never chose.
        //
        // Anchoring each form on its own title element instead — cards on
        // .contract-option-title, list options on their .font-600 title
        // span — cannot match a tab, because tabs have neither.
        name: 'option card or list option',
        build: p =>
          p
            .locator('.embla__slide')
            .filter({ has: p.locator('.contract-option-title', { hasText: exactly }) })
            .or(p.locator('button').filter({ has: p.locator('span.font-600', { hasText: exactly }) })),
      },
      { name: 'role=button', build: p => p.getByRole('button', { name: contains }) },
      {
        name: 'clickable card containing the label',
        build: p => p.locator('[class*="cursor-pointer"]').filter({ hasText: contains }),
      },
    ]);
  }

  async assertLoaded(): Promise<void> {
    await expect(
      this.page.getByRole('heading', { name: /build your own/i }).first(),
    ).toBeVisible({ timeout: 30_000 });
    await this.checkpointReached('01-byoc-landing');
  }

  /**
   * Answer one accordion question.
   *
   * The scrollIntoViewIfNeeded is doing real work, not defensive padding:
   * the page never scrolls to a revealed step by itself, so on the mobile
   * project the third question renders roughly two screens below the fold
   * and Playwright would otherwise click at a point outside the viewport.
   */
  async choose(label: string): Promise<void> {
    // 8s per candidate, not the 3s default: answering a question mounts the
    // next one through a fresh render, and on a cold CI runner the reveal
    // regularly takes longer than three seconds.
    const option = await this.option(label).resolve(8000);
    await option.scrollIntoViewIfNeeded();
    await option.click();
    console.info(`[FUNNEL] landing accordion: chose "${label}"`);
  }

  /**
   * Measure how far the advancing CTA sits below the fold once every
   * question is answered, and attach it to the report.
   *
   * This is a UX regression guard, not a pass/fail assertion about layout:
   * on a 375x812 viewport this returned ~1498px against an 812px viewport
   * with the page still scrolled to the top. If that number grows, the flow
   * has got harder to complete, and the report will say so.
   */
  async measureCtaOffset(ctaLabel: string): Promise<{ ctaTop: number; viewportHeight: number }> {
    const cta = await this.option(ctaLabel).resolve();
    const box = await cta.boundingBox();
    const viewportHeight = this.page.viewportSize()?.height ?? 0;
    const scrollY = await this.page.evaluate(() => window.scrollY);
    const ctaTop = Math.round((box?.y ?? 0) + scrollY);
    console.info(
      `[UX] advancing CTA "${ctaLabel}" sits at y=${ctaTop}px `
        + `in a ${viewportHeight}px viewport (page scrollY=${scrollY})`,
    );
    return { ctaTop, viewportHeight };
  }

  /** Walk the whole accordion and cross into the builder proper. */
  async startBuilding(connection: string, contractType: string, intent: string): Promise<void> {
    await this.choose(connection);
    await this.choose(contractType);
    await this.choose(intent);
    await this.checkpointReached('02-byoc-accordion-complete');
    await this.choose('Next: Choose a device');
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
