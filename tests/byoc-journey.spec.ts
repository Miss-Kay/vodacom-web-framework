import { test, expect } from '@playwright/test';
import { DealBuilderLandingPage } from '../pages/DealBuilderLandingPage';
import { DealBuilderPage } from '../pages/DealBuilderPage';
import { CheckoutPage } from '../pages/CheckoutPage';
import { DealPage } from '../pages/DealPage';
import { contractMatrix, iphone15Contract, doubleDeal } from '../fixtures/testData';
import { site } from '../fixtures/siteProfile';

/**
 * BUILD YOUR OWN CONTRACT — the flagship acquisition funnel.
 *
 * One test per entry in the contract matrix. Each launches the real shop,
 * answers the landing accordion, picks a handset, declines the Double Deal
 * upsell, and asserts the plan step offers plans — stopping well before
 * checkout takes any personal data.
 *
 * On the @known-defect convention: a test covering a defect that is already
 * reported and still open gets tagged @known-defect, which `npm test` and CI
 * exclude. A permanently red pipeline hides the next regression, so a known
 * failure is quarantined and re-checked on demand with `npm run test:defects`
 * rather than left to rot the signal.
 *
 * Quarantined at present: everything that opens doubleDeal.path, because
 * /shop/dv6hb00314 now 404s — the checkout-gate test below, and both tests
 * in packaged-deal.spec.ts. See the note on doubleDeal in
 * fixtures/testData.ts.
 */
test.describe(`${site.name} — Build Your Own Contract`, () => {
  for (const journey of contractMatrix) {
    test(`customer can build a contract up to the plan step — ${journey.label} @funnel @smoke`, async ({
      page,
    }) => {
      const landing = new DealBuilderLandingPage(page);
      const builder = new DealBuilderPage(page);

      await test.step('Step 1 — open Build Your Own Contract', async () => {
        await landing.open(site.paths.dealBuilderLanding);
        test.skip(
          await landing.isBotBlocked(),
          `${site.name} served its bot-protection page to this runner IP — skipping (not a code failure)`,
        );
        await landing.assertLoaded();
      });

      await test.step('Step 2 — answer the landing accordion', async () => {
        await landing.startBuilding(
          journey.connection,
          journey.contractType,
          journey.contractIntent,
        );
      });

      await test.step('Step 3 — the device step offers devices', async () => {
        await builder.assertOnDeviceStep();
        const offered = await builder.devicesOffered();
        expect(offered, 'the device step rendered no devices to choose from').toBeGreaterThan(0);
        console.info(`[FUNNEL] device step offered ${offered} devices`);
      });

      await test.step(`Step 4 — select the ${journey.device}`, async () => {
        await builder.selectDevice(journey.device, journey.deviceSku);
      });

      await test.step('Step 5 — advance to the plan step', async () => {
        await builder.advance();
        await builder.assertOnPlanStep();
      });

      await test.step('Step 6 — the plan step offers plans for the chosen device', async () => {
        await builder.assertPlansOffered(journey.minPlansOffered);
      });
    });
  }

  /**
   * The second plan path, asserted separately.
   *
   * "Our top picks" offers three curated plans; "Build my own plan" is the
   * configurator behind it, and it is the only route to any plan outside
   * those three. A customer who wants more data than the top pick carries
   * has nowhere else to go, so it is worth its own test rather than being
   * assumed healthy because the rail beside it rendered.
   */
  test(`the manual plan configurator still works @funnel`, async ({ page }) => {
    const landing = new DealBuilderLandingPage(page);
    const builder = new DealBuilderPage(page);

    await landing.open(site.paths.dealBuilderLanding);
    test.skip(await landing.isBotBlocked(), 'bot-protection page served — skipping');
    await landing.assertLoaded();
    await landing.startBuilding(
      iphone15Contract.connection,
      iphone15Contract.contractType,
      iphone15Contract.contractIntent,
    );
    await builder.assertOnDeviceStep();
    await builder.selectDevice(iphone15Contract.device, iphone15Contract.deviceSku);
    await builder.advance();
    await builder.assertOnPlanStep();

    expect(
      await builder.buildMyOwnPlanIsUsable(),
      'Both plan paths are now broken: the recommended rail is empty and the manual '
        + 'configurator did not render. Build Your Own Contract cannot be completed.',
    ).toBe(true);
  });
});

/**
 * UX REGRESSION GUARD — how far the customer has to travel.
 *
 * Not a layout assertion. The landing page reveals each answered question
 * BELOW the last one without scrolling to it, so the CTA that actually
 * advances the flow sits roughly two screens down on a phone with the page
 * still at the top. Measured, attached to the report, and failed only if it
 * gets materially worse — a threshold, not a pixel lock.
 */
test(`the advancing CTA stays reachable after the accordion is answered @funnel`, async ({
  page,
}) => {
  const landing = new DealBuilderLandingPage(page);
  await landing.open(site.paths.dealBuilderLanding);
  test.skip(await landing.isBotBlocked(), 'bot-protection page served — skipping');
  await landing.assertLoaded();

  await landing.choose(iphone15Contract.connection);
  await landing.choose(iphone15Contract.contractType);
  await landing.choose(iphone15Contract.contractIntent);

  const { ctaTop, viewportHeight } = await landing.measureCtaOffset('Next: Choose a device');
  const screensBelowFold = ctaTop / viewportHeight;

  await test.info().attach('cta-reachability.txt', {
    body:
      `Advancing CTA top: ${ctaTop}px\n`
      + `Viewport height: ${viewportHeight}px\n`
      + `Screens from the top of the page: ${screensBelowFold.toFixed(2)}`,
    contentType: 'text/plain',
  });

  expect(
    screensBelowFold,
    `The CTA that advances the flow sits ${screensBelowFold.toFixed(2)} screens down `
      + 'and the page does not scroll to it. Customers tap an option, see nothing '
      + 'change, and leave.',
  ).toBeLessThan(3);
});

/**
 * THE CHECKOUT GATE — reached through the funnel, not deep-linked.
 *
 * Deep-linking to /shop/checkout with an empty cart just redirects away, so
 * that version of this test skipped every run and the safety rails below —
 * the ones that prove this suite never submits anyone's ID number — were
 * never actually exercised. A guard rail that never runs is decoration.
 *
 * So the journey walks a real deal to the gate, records what is demanded
 * there, and asserts nothing was filled in.
 */
test(`checkout asks for identity documents and the suite stops there @funnel @smoke @known-defect`, async ({
  page,
}) => {
  const deal = new DealPage(page);
  const builder = new DealBuilderPage(page);
  const checkout = new CheckoutPage(page);

  await deal.open(doubleDeal.path);
  test.skip(await deal.isBotBlocked(), 'bot-protection page served — skipping');
  await deal.assertLoaded(doubleDeal.heading);
  await deal.pressCta(doubleDeal.primaryCta);
  await page.waitForTimeout(6000);

  const reached = await builder.proceedToCheckout();
  expect(reached, `never reached the checkout gate; stopped at ${page.url()}`).toBe(true);

  await checkout.assertApplicationGateReached();
  await checkout.describeGate();
  console.info(`[GATE] scarcity countdown shown: ${await checkout.hasExpiryCountdown()}`);

  // The point of the whole test: prove the run stopped here.
  await checkout.assertNeverSubmitted();
});
