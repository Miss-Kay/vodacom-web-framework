import { Page, expect, test } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Upgrade — /shop/upgrade.
 *
 * THE JOURNEY STOPS AT THE ELIGIBILITY FORM, BY DESIGN.
 *
 * Submitting a cellphone number here sends a one-time PIN by SMS to whoever
 * owns that number. There is no test number on production, so the suite
 * asserts the gate renders and never fills it — the same rule as
 * CheckoutPage, and enforced the same way.
 *
 * What is worth recording: this flow is OTP-gated BEFORE any deal is shown.
 * An existing customer — the highest-intent segment there is — cannot browse
 * a single upgrade offer without proving they hold the SIM.
 */
export class UpgradePage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  async assertLoaded(): Promise<void> {
    await expect(
      this.page.getByRole('heading', { name: /do an upgrade check/i }).first(),
    ).toBeVisible({ timeout: 45_000 });
    await this.checkpointReached('01-upgrade-eligibility-gate');
  }

  /** True when no offer is visible before the OTP gate is satisfied. */
  async gatesOffersBehindOtp(): Promise<boolean> {
    const numberField = this.page.locator('input[name*="cell"], input[type="tel"]').first();
    const gateVisible = await numberField.isVisible().catch(() => false);

    const offersVisible = await this.page
      .locator('[class*="deal-card"], [class*="product-card"]')
      .first()
      .isVisible()
      .catch(() => false);

    const gated = gateVisible && !offersVisible;
    await test.info().attach('upgrade-gate.txt', {
      body:
        `Eligibility form visible: ${gateVisible}\n`
        + `Upgrade offers visible before OTP: ${offersVisible}\n`
        + `Offers gated behind OTP: ${gated}`,
      contentType: 'text/plain',
    });
    return gated;
  }

  /** Guard rail — mirrors CheckoutPage.assertNeverSubmitted(). */
  async assertNeverSubmitted(): Promise<void> {
    const field = this.page.locator('input[name*="cell"], input[type="tel"]').first();
    if ((await field.count()) === 0) return;
    const value = await field.inputValue().catch(() => '');
    expect(
      value,
      'SAFETY: a cellphone number was entered on the upgrade form. Submitting it '
        + 'sends a live OTP by SMS to whoever owns that number.',
    ).toBe('');
    console.info('[SAFETY] no number entered — upgrade journey stopped at the gate');
  }
}
