/**
 * SITE PROFILE — every site-specific value lives in this one object.
 *
 * Adopting the framework for another operator (or another Vodacom market)
 * means writing a new profile plus page objects for that site's shop;
 * nothing else in the framework references Vodacom South Africa directly.
 */
export interface SiteProfile {
  /** Human name — used in logs, reports, and test titles. */
  name: string;
  /** Default base URL; the BASE_URL env var overrides it. */
  baseUrl: string;
  /** Entry path the journey launches from. */
  entryPath: string;
  /** Browser locale for the test context. */
  locale: string;
  /** Currency symbol prices are quoted in, used by the price assertions. */
  currencySymbol: string;

  /**
   * The shop is a Magento/Hyvä storefront mounted at /shop, while account,
   * login and eSIM live in a separate application at /cloud, and marketing
   * content sits at /vodacom. A customer crosses all three in one purchase,
   * so the paths are named here rather than scattered through page objects.
   */
  paths: {
    shop: string;
    dealBuilderLanding: string;
    dealBuilder: string;
    upgrade: string;
    cart: string;
    checkout: string;
    login: string;
  };

  /**
   * The deal builder keeps its entire state in the query string, e.g.
   *   ?connection=mobile&type=device&contract=new&step=plan&device=100021503
   * That makes every step addressable and assertable, which is what these
   * patterns are for.
   */
  dealBuilder: {
    /** Proves we reached the device step. */
    deviceStepPattern: RegExp;
    /** Proves we reached the plan step. */
    planStepPattern: RegExp;
    /** Proves we reached the add-ons step. */
    addOnStepPattern: RegExp;
  };

  /** Proves the checkout application gate was reached (see CheckoutPage). */
  checkoutUrlPattern: RegExp;

  /**
   * Query parameters that change between page loads without changing where
   * the link goes, stripped when computing a link's baseline identity.
   *
   * Without this the link baseline churns on every run and its failures stop
   * meaning anything. The header "Log in" link is the clearest case: it
   * carries `vod-web-redirect`, a base64 copy of the page you came from, so
   * the same control produces a different URL on every page and the diff
   * reports it as one journey lost and one journey gained, every time.
   * The campaign parameters do the same thing more quietly.
   *
   * Only the baseline KEY is normalised. Links are still fetched at their
   * full URL, so a redirect that only breaks with the campaign parameter
   * attached is still caught.
   */
  volatileQueryParams: string[];

  /**
   * Signatures of the site's bot-protection / "access restricted"
   * interstitial — the URL it redirects to, and text unique to the page.
   * When a request is served this page, the test skips rather than
   * false-failing. See BasePage.isBotBlocked().
   *
   * NB: unverified. Vodacom served an automated browser normally from a
   * residential IP during development, so no real block page has been
   * observed. The generic pattern below is a safety net for datacenter CI
   * runners; replace it with the real signature the first time a run is
   * blocked, and delete it if Vodacom never blocks.
   */
  botBlockUrlPattern?: RegExp;
  botBlockPattern?: RegExp;
}

/**
 * Vodacom South Africa — the active target.
 *
 * Every journey in this suite is READ-ONLY. It browses the public shop and
 * stops at the first gate that would take personal data or send an SMS:
 *   - the checkout stops at the "Start your application" form and never
 *     enters an ID number (CheckoutPage refuses to, by design)
 *   - the upgrade flow stops at the eligibility form and never submits a
 *     cellphone number, so no customer is ever sent an OTP
 * It never signs in, never adds a payment method, and never places an order.
 */
export const vodacomSA: SiteProfile = {
  name: 'Vodacom SA',
  baseUrl: 'https://www.vodacom.co.za',
  entryPath: '/shop/',
  locale: 'en-ZA',
  currencySymbol: 'R',

  paths: {
    shop: '/shop/',
    dealBuilderLanding: '/shop/deal-builder/landing',
    dealBuilder: '/shop/deal-builder',
    upgrade: '/shop/upgrade',
    cart: '/shop/checkout/cart/index/',
    checkout: '/shop/checkout',
    login: '/cloud/digital/login',
  },

  dealBuilder: {
    deviceStepPattern: /[?&]step=device\b/i,
    planStepPattern: /[?&]step=plan\b/i,
    addOnStepPattern: /[?&]step=addOn\b/i,
  },

  checkoutUrlPattern: /\/shop\/checkout(\?|$|\/)/i,

  volatileQueryParams: ['vod-web-redirect', 'icmp', 'linkpos', 'cid', 'cmp'],

  botBlockUrlPattern: undefined,
  botBlockPattern: /access denied|request blocked|unusual traffic|are you a robot/i,
};

/** The profile the suite runs against. */
export const site: SiteProfile = vodacomSA;
