import { Page, expect, test } from '@playwright/test';
import { BasePage } from './BasePage';
import { site } from '../fixtures/siteProfile';

/**
 * Checkout — /shop/checkout.
 *
 * THE JOURNEY STOPS HERE, BY DESIGN.
 *
 * The first thing this page asks for is a South African ID number, and
 * submitting it runs a real credit check against a real person at a real
 * credit bureau. There is no test mode and no sandbox on production. So this
 * page object can assert that the gate was reached and describe what it
 * demands, and it deliberately offers no method that fills or submits the
 * form. assertNeverSubmitted() below turns that convention into something
 * the suite enforces rather than something a reviewer has to remember.
 *
 * What the gate is worth measuring: it is the single largest drop-off point
 * in South African telco e-commerce. The suite records what the customer is
 * asked for, how many steps they can see ahead of them, and whether the
 * reassurance copy that makes the ask survivable is still on the page.
 */
export class CheckoutPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  async assertApplicationGateReached(): Promise<void> {
    await this.expectUrlContains(site.checkoutUrlPattern);
    await expect(
      this.page.getByRole('heading', { name: /start your application/i }).first(),
    ).toBeVisible({ timeout: 45_000 });
    await this.checkpointReached('08-checkout-application-gate');
  }

  /**
   * The identity documents the gate demands, in the order a customer meets
   * them. Reported, not asserted — this is a record of what the funnel costs
   * the customer, and it belongs in the report next to the drop-off numbers.
   */
  async describeGate(): Promise<string[]> {
    const fields = ['sa_id_number', 'passport_number', 'cellphone', 'email_address'];
    const demanded: string[] = [];
    for (const name of fields) {
      const field = this.page.locator(`[name="${name}"]`).first();
      if ((await field.count()) === 0) continue;
      const required = (await field.getAttribute('required')) !== null;
      const visible = await field.isVisible().catch(() => false);
      demanded.push(`${name}${required ? ' (required)' : ''}${visible ? '' : ' [hidden branch]'}`);
    }

    // Reassurance copy is what makes handing over an ID number survivable.
    // If it is ever removed, conversion will move and nobody will know why.
    const reassurances = [
      /apply in less than \d+ min/i,
      /no documents needed/i,
      /instant results/i,
    ];
    const present: string[] = [];
    for (const pattern of reassurances) {
      if (await this.page.getByText(pattern).first().isVisible().catch(() => false)) {
        present.push(pattern.source);
      }
    }

    const report = [
      `Identity fields demanded: ${demanded.join(', ') || 'none found'}`,
      `Reassurance copy present: ${present.length}/${reassurances.length}`,
    ];
    await test.info().attach('checkout-gate.txt', {
      body: report.join('\n'),
      contentType: 'text/plain',
    });
    console.info(`[GATE] ${report.join(' | ')}`);
    return report;
  }

  /**
   * True when the page shows a countdown pressuring the customer to decide.
   *
   * Worth recording rather than failing on: an artificial scarcity timer at
   * the exact moment someone is being asked for their ID number is a
   * deliberate product choice, and knowing whether it is live changes how
   * the drop-off numbers at this step should be read.
   */
  async hasExpiryCountdown(): Promise<boolean> {
    return this.page
      .getByText(/this deal expires in/i)
      .first()
      .isVisible()
      .catch(() => false);
  }

  /**
   * Guard rail. Fails the test if anything in the run put a value into an
   * identity field — including a future edit to this framework that adds a
   * well-meaning "fill in test data" helper.
   *
   * Every journey that reaches checkout calls this as its last step, so the
   * read-only promise in the README is enforced by the suite rather than
   * relying on nobody ever changing it.
   */
  async assertNeverSubmitted(): Promise<void> {
    const identityFields = ['sa_id_number', 'passport_number', 'cellphone', 'email_address'];
    for (const name of identityFields) {
      const field = this.page.locator(`[name="${name}"]`).first();
      if ((await field.count()) === 0) continue;
      const value = await field.inputValue().catch(() => '');
      expect(
        value,
        `SAFETY: "${name}" was populated during the run. This suite must never enter `
          + 'personal data — submitting it runs a live credit check against a real person.',
      ).toBe('');
    }
    console.info('[SAFETY] no identity field was populated — journey stopped at the gate');
  }
}
