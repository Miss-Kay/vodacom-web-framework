/** Typed test data — single source of truth, easy to extend to data-driven runs. */

/**
 * One pass through Build Your Own Contract:
 *   landing accordion → device → plan → add-ons → review → checkout gate.
 */
export interface ContractJourney {
  /** Label shown in the test title. */
  label: string;
  /** Landing accordion, question 1: "What would you like to build today?" */
  connection: string;
  /** Landing accordion, question 2: "Choose your contract type". */
  contractType: string;
  /** Landing accordion, question 3: "New contract or upgrade?" */
  contractIntent: string;
  /** Device to select on the device step, matched on the card's title. */
  device: string;
  /** Magento SKU the URL must carry once the device is selected. */
  deviceSku: string;
  /** Minimum plans the plan step must offer to be considered healthy. */
  minPlansOffered: number;
}

/**
 * The reference journey: a new customer building a contract around an
 * iPhone 15 — the device the shop itself ranks first under "Popular with
 * other customers".
 */
export const iphone15Contract: ContractJourney = {
  label: 'new mobile contract with an iPhone 15',
  connection: 'Mobile contract',
  contractType: 'With a device',
  contractIntent: 'Get a new contract',
  device: 'Apple iPhone 15 128GB 5G',
  deviceSku: '100021503',
  minPlansOffered: 1,
};

/**
 * A second device through the same funnel, proving the page objects are
 * driven by data and not hard-wired to one handset.
 */
export const iphone16eContract: ContractJourney = {
  label: 'new mobile contract with an iPhone 16e',
  connection: 'Mobile contract',
  contractType: 'With a device',
  contractIntent: 'Get a new contract',
  device: 'Apple iPhone 16e 128GB',
  deviceSku: '100022907',
  minPlansOffered: 1,
};

/**
 * Data-driven matrix — the spec generates one test per entry.
 *
 * Both devices are in the default run. Unlike the Standard Bank suite, the
 * known live defect here is NOT excluded by removing a row: it is isolated
 * in its own @known-defect test (see tests/byoc-journey.spec.ts), so the
 * green run still walks the whole funnel for both handsets.
 */
export const contractMatrix: ContractJourney[] = [iphone15Contract, iphone16eContract];

/**
 * A pre-packaged deal, reached from a product page rather than the builder.
 *
 * Product URLs on this shop are opaque SKUs with no slug, so the readable
 * name lives here instead. This one is the "Double Deal" the shop promotes
 * on its smartphone-deals listing.
 */
export interface PackagedDeal {
  label: string;
  /** Path of the product detail page. */
  path: string;
  /** Text that proves the right PDP rendered. */
  heading: RegExp;
  /** The primary call to action a customer would press to buy it. */
  primaryCta: string;
}

/**
 * QUARANTINED 2026-09-08 — this deal page is gone.
 *
 * /shop/dv6hb00314 returns 404. Confirmed outside Playwright with a plain
 * browser-shaped request, so the page is genuinely dead rather than the
 * checker being refused. Every test that opens it is tagged @known-defect
 * until Vodacom either restores the SKU or pulls the deal from its listing.
 *
 * Deliberately NOT repointed at a live deal. Swapping the path would turn
 * the pipeline green while a promoted deal still 404s for customers, and
 * this shop has now fixed two other defects this suite reported — the
 * doubled "SIM only" href and the Motorola G37 id — so keeping it visible
 * is what gets it fixed. Re-check with: npm run test:defects
 */
export const doubleDeal: PackagedDeal = {
  label: 'iPhone 16 + iPhone 15 Double Deal',
  path: '/shop/dv6hb00314?price_type=monthly',
  // \s+, not a literal space. Magento stores this product name with a
  // non-breaking space inside the second device's "128GB 5G", which is
  // invisible on screen and matches no ordinary space pattern. Matching all
  // internal whitespace loosely costs nothing and avoids a failure that
  // would look like a broken page and is really a stray U+00A0.
  heading: /iPhone 16 128GB\s+5G\s*\+\s*Apple iPhone 15 128GB\s+5G/i,
  primaryCta: 'Get this deal',
};

/**
 * Pages the content-integrity sweep runs over. These are the screens a
 * customer is standing on while deciding whether to hand over an ID number,
 * so unrendered placeholders here cost real conversion.
 */
export interface ScannedPage {
  name: string;
  path: string;
}

export const contentScanPages: ScannedPage[] = [
  { name: 'Shop home', path: '/shop/' },
  { name: 'Build Your Own Contract landing', path: '/shop/deal-builder/landing' },
  { name: 'Upgrade', path: '/shop/upgrade' },
  { name: 'Smartphone deals listing', path: '/shop/all-deals/smartphone-deals' },
  { name: 'Double Deal product page', path: '/shop/dv6hb00314?price_type=monthly' },
];

/**
 * Broken links already found, reported, and still live.
 *
 * Why an allowlist rather than tagging the whole link test @known-defect:
 * quarantining the test would also stop it detecting the NEXT broken link,
 * and detecting those is the only reason it exists. Naming the individual
 * URLs keeps the test red-on-new-damage and green on damage already raised.
 *
 * Every entry needs a date and a reason, and entries are meant to be
 * deleted — an allowlist that only ever grows is a slow way of turning the
 * check off.
 *
 * Found 2026-09-06 on /shop/ (both internal, both HTTP 404):
 *   - DV6G09DAAA — a top-deal card links to a SKU that does not resolve.
 *     Appears twice on the page.
 *   - DV6H12DABE — the PlayStation 5 Digital top-deal card. Note the
 *     redirect: the uppercase SKU 301s to lowercase /shop/dv6h12dabe and
 *     that 404s too, which points at case handling in the URL rewrite
 *     rather than at a merchandiser typo.
 */
export const knownBrokenLinks: { url: RegExp; found: string; note: string }[] = [
  {
    url: /\/shop\/DV6G09DAAA$/i,
    found: '2026-09-06',
    note: 'top-deal card links to an unresolvable SKU (x2 on the page)',
  },
  {
    url: /\/shop\/DV6H12DABE/i,
    found: '2026-09-06',
    note: 'PlayStation 5 Digital top-deal card; uppercase SKU redirects to lowercase, which also 404s',
  },
];
