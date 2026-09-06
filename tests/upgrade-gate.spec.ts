import { test, expect } from '@playwright/test';
import { UpgradePage } from '../pages/UpgradePage';
import { site } from '../fixtures/siteProfile';

/**
 * UPGRADE — the existing-customer funnel.
 *
 * The suite stops at the eligibility form: submitting a number here sends a
 * real OTP by SMS to whoever owns it. See UpgradePage.
 *
 * What this records is the shape of the gate. Offers sit behind an OTP, so
 * the highest-intent segment on the site — customers who already pay
 * Vodacom every month — cannot see a single upgrade price without proving
 * they are holding the SIM. That is a defensible fraud control and an
 * expensive front door, and the run should say which one it currently is.
 */
test.describe(`${site.name} — upgrade`, () => {
  test(`the upgrade eligibility gate renders @funnel @smoke`, async ({ page }) => {
    const upgrade = new UpgradePage(page);

    await upgrade.open(site.paths.upgrade);
    test.skip(await upgrade.isBotBlocked(), 'bot-protection page served — skipping');
    await upgrade.assertLoaded();

    const gated = await upgrade.gatesOffersBehindOtp();
    console.info(`[FUNNEL] upgrade offers gated behind OTP: ${gated}`);

    // Reassurance copy is what carries a customer through an OTP wall.
    await expect(
      page.getByText(/upgrade in \d+ minutes|no documents needed/i).first(),
    ).toBeVisible({ timeout: 20_000 });

    await upgrade.assertNeverSubmitted();
  });
});
