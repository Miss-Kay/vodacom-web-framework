import { test, expect } from '@playwright/test';
import { DealPage } from '../pages/DealPage';
import { DealBuilderPage } from '../pages/DealBuilderPage';
import { doubleDeal } from '../fixtures/testData';
import { site } from '../fixtures/siteProfile';
import { firstVisible } from '../utils/selfHealing';

/**
 * PACKAGED DEAL → CHECKOUT
 *
 * The other way into the funnel, and the one most marketing traffic takes:
 * a customer lands on a ready-made deal from an ad or the deals listing and
 * presses the primary button.
 *
 * The behaviour worth asserting is where that button goes. Someone who
 * chooses a pre-packaged deal has explicitly opted out of configuring
 * anything — so a CTA that drops them into the configurator has undone the
 * choice they just made.
 */
test.describe(`${site.name} — packaged deal`, () => {
  test(`the deal page renders and its CTAs are countable @funnel @smoke`, async ({ page }) => {
    const deal = new DealPage(page);

    await deal.open(doubleDeal.path);
    test.skip(await deal.isBotBlocked(), 'bot-protection page served — skipping');
    await deal.assertLoaded(doubleDeal.heading);

    const ctas = await deal.callsToAction();
    expect(ctas.length, 'the deal page offered no call to action at all').toBeGreaterThan(0);

    // Reported, not failed: three near-equal CTAs at the buy moment is a
    // choice-paralysis risk worth watching, but it is a product decision.
    await test.info().attach('competing-ctas.txt', {
      body: `${ctas.length} competing calls to action: ${ctas.join(', ')}`,
      contentType: 'text/plain',
    });
  });

  /**
   * Where "Get this deal" actually lands.
   *
   * Today it does not add the deal to the cart. It redirects into the deal
   * builder at step=addOn — the configurator the customer chose a packaged
   * deal to avoid — and the add-ons step there renders its heading and
   * prompt with no options beneath them.
   *
   * The assertion is deliberately loose: it fails only if the CTA leads
   * somewhere with neither a cart nor a usable next step, because whether
   * the redirect is a bug or a product decision is Vodacom's call. What is
   * not a product decision is landing the customer on an empty screen.
   */
  test(`the primary CTA leads somewhere the customer can act @funnel`, async ({ page }) => {
    const deal = new DealPage(page);
    const builder = new DealBuilderPage(page);

    await deal.open(doubleDeal.path);
    test.skip(await deal.isBotBlocked(), 'bot-protection page served — skipping');
    await deal.assertLoaded(doubleDeal.heading);

    await deal.pressCta(doubleDeal.primaryCta);
    await page.waitForTimeout(6000); // the builder mounts through several GraphQL round-trips

    const landedInBuilder = site.dealBuilder.addOnStepPattern.test(page.url());
    const landedInCart = /checkout\/cart/i.test(page.url());

    await test.info().attach('cta-destination.txt', {
      body:
        `"${doubleDeal.primaryCta}" led to: ${page.url()}\n`
        + `Added to cart: ${landedInCart}\n`
        + `Redirected into the configurator: ${landedInBuilder}`,
      contentType: 'text/plain',
    });

    if (landedInCart) return; // the straightforward outcome — nothing to check

    expect(
      landedInBuilder,
      `"${doubleDeal.primaryCta}" neither added the deal to the cart nor opened the `
        + `configurator. It went to ${page.url()}.`,
    ).toBe(true);

    // It went to the configurator. The customer must at least be able to
    // continue from there.
    const addOns = await builder.addOnsOffered();
    // "Is there a way forward?", not "is there a button called Review".
    // The two breakpoints label the same step differently — mobile offers
    // "Review", desktop offers "Start application" — so naming one of them
    // makes the test pass on one project and fail on the other while the
    // customer is equally able to continue on both.
    const wayForward = await firstVisible(
      page,
      page.locator('button').filter({ hasText: /review|start application|continue|next/i }),
      15_000,
    );
    const canReview = wayForward !== null;

    console.info(
      `[FUNNEL] add-ons step offered ${addOns} option(s); way forward available: ${canReview}`
        + (wayForward ? ` ("${(await wayForward.textContent())?.trim()}")` : ''),
    );
    expect(
      canReview,
      'The primary CTA redirected into the add-ons step, which offered no options '
        + 'and no way to continue. The customer is stranded.',
    ).toBe(true);
  });
});
