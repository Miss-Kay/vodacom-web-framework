# Vodacom Web Framework

Playwright + TypeScript automation for the **Vodacom South Africa** online shop —
funnel journeys, content integrity, and link integrity, run on every push and on a
schedule, with reports published to an S3 static site.

Built on the same architecture as
[`standardbank-web-framework`](https://github.com/Miss-Kay/standardbank-web-framework)
and `flysafair-booking-framework`: a single site profile, page objects with
self-healing locators, data-driven specs, and OIDC-authenticated CI.

```bash
npm ci
npx playwright install --with-deps chromium
npm test
```

---

## What it tests, and why those things

Vodacom's shop is a purchase funnel, so the suite is organised around **where a
customer can fall out of it** rather than around pages.

| Suite | Tag | What it proves |
|---|---|---|
| Build Your Own Contract | `@funnel` | A customer can go landing → device → plan, for each device in the matrix, and the plan step actually offers plans |
| Packaged deal | `@funnel` | A ready-made deal page renders, and its primary CTA leads somewhere the customer can act |
| Checkout gate | `@funnel` | The funnel reaches the application gate — and the suite provably stops there |
| Upgrade | `@funnel` | The eligibility gate renders, without ever sending an OTP |
| Content integrity | `@content` | No placeholder text (`undefined`, `NaN`, `{{ }}`) leaked into customer-facing copy |
| Link integrity | `@links` | Every link on the shop home resolves, and none have gone missing since the baseline |

```bash
npm test              # everything except quarantined defects, both viewports
npm run test:funnel   # journeys only
npm run test:content  # placeholder sweep
npm run test:links    # link resolution + baseline diff
npm run test:headed   # watch it drive Chromium
npm run typecheck
npm run report        # open the last HTML report
```

### Desktop and mobile are both first-class

`playwright.config.ts` defines two projects — `chromium` at 1440×900 and `mobile`
on a Pixel 7 — and both run in CI. This is not thoroughness for its own sake.
Vodacom's traffic is overwhelmingly mobile, and the shop genuinely behaves
differently at 375px: the deal builder's advancing CTA moves into a fixed bottom
bar, and the add-ons step offers a "Review" button where desktop offers
"Start application". A desktop-only suite would have asserted on one of those and
quietly stopped covering the other.

---

## The read-only guarantee

**The suite never submits personal data, and enforces that on itself.**

Two gates in this funnel have real-world consequences on production, where there
is no test mode and no sandbox:

- **Checkout** asks for a South African ID number. Submitting it runs a live
  credit check against a real person at a real credit bureau.
- **Upgrade** asks for a cellphone number. Submitting it sends a real OTP by SMS
  to whoever owns that number.

So `CheckoutPage` and `UpgradePage` expose no method that fills or submits either
form, and every journey that reaches a gate ends with `assertNeverSubmitted()`,
which fails the test if any identity field holds a value. That turns the promise
from a convention someone has to remember into something the suite checks — a
future "helpful" change that adds a fill-in-test-data helper turns the build red.

The suite also never signs in, never adds a payment method, and never places an
order.

---

## Structure

```
fixtures/
  siteProfile.ts        every Vodacom-specific value — URLs, step patterns, volatile params
  testData.ts           journey matrix, packaged deal, scan pages, known-broken allowlist
  shop-links.baseline.json
pages/
  BasePage.ts           consent handling, checkpoints, bot-block detection
  ShopHomePage.ts       shop home + link collection
  DealBuilderLandingPage.ts   the four-question accordion
  DealBuilderPage.ts    device → plan → add-ons → review → checkout
  DealPage.ts           packaged deal PDP
  CheckoutPage.ts       the application gate (read-only, with a guard rail)
  UpgradePage.ts        the eligibility gate (read-only, with a guard rail)
utils/
  selfHealing.ts        ordered locator fallbacks + firstVisible()
  linkChecker.ts        link collection, resolution, verdict classification
  linkBaseline.ts       snapshot + diff, so lost links fail
  contentIntegrity.ts   placeholder leak detection
tests/                  the five suites above
scripts/
  setup-aws-reports.sh  one-time AWS bootstrap for report publishing
```

Adopting this for another operator means writing a new `SiteProfile` and page
objects for that shop's navigation. Nothing in `utils/` mentions Vodacom.

---

## Three things this shop taught the framework

These are worth reading before changing a locator, because each one produced a
test that failed while the site was working perfectly — or worse, passed while
doing nothing.

### 1. `.first()` is usually the wrong element

The deal builder renders **every step and every modal into one document**. A
search for "Get this deal", "Review" or "Data & voice minutes" routinely matches
several nodes, of which one is on screen. Asserting on `.first()` asserts on
whichever copy comes first in DOM order — normally a hidden one — so the
assertion fails on a working page, and `click()` hangs until the test times out.

`firstVisible()` in `utils/selfHealing.ts` scans a locator's matches for the
first visible one and is used throughout. Prefer it to `.first()` here.

### 2. Anchored text matches find nothing

Buttons on this shop carry icon text alongside their labels, so a button reading
"Next" has `innerText` of `"\n Next \n\narrow-right\n"`. Every `^\s*Label\s*$`
pattern in the first draft matched nothing. Worse, the *advancing* CTA is
labelled per step — "Next: Choose a device", then "Next: Choose my plan" — while
two decoy `Next` buttons render at 0×0 on every step.

### 3. A same-named tab will eat your click

Answering a question in the landing accordion also renders a **tab strip whose
buttons carry the same labels** ("With a device" | "SIM only"). A loose text
selector binds to the tab, the click does nothing, the next question never
reveals — and the run cheerfully logs that it chose the option it never chose.

The fix is precision, not force: option cards are matched via
`.contract-option-title` and list options via their `span.font-600` title, and
neither can match a tab, because tabs have neither element.

---

## Handling defects that are already reported

A permanently red pipeline hides the next regression, so known-open defects are
handled explicitly rather than left to rot the signal.

- **`@known-defect`** tags a test covering a reported, still-open defect.
  `npm test` and CI exclude it; `npm run test:defects` re-checks it on demand, and
  CI runs it in a `continue-on-error` step so the report says whether it is fixed.
  *Nothing is quarantined at present.*
- **`knownBrokenLinks`** (in `fixtures/testData.ts`) does the same at link
  granularity. Tagging the whole link test would stop it finding the *next*
  broken link, which is the only reason it exists — so individual URLs are
  allowlisted with a date and a reason, and anything new still fails the run.

Both are meant to shrink. An allowlist that only grows is a slow way of turning
the check off.

---

## Live findings

Found by this suite against production on **2026-09-06**.

**Two broken links on the shop home page**, both internal, both HTTP 404,
currently allowlisted in `fixtures/testData.ts`:

- `/shop/DV6G09DAAA` — a top-deal card pointing at a SKU that does not resolve.
  Appears twice on the page.
- `/shop/DV6H12DABE` — the PlayStation 5 Digital top-deal card. The uppercase SKU
  301s to lowercase `/shop/dv6h12dabe`, which also 404s. The redirect points at
  case handling in the URL rewrite rather than a merchandiser typo.

**A QA hostname in production markup.** "Browse all HONOR products" links to
`wwwqa.vodacom.co.za`. It answers 403 to an automated request so the checker
reports it as unverified rather than broken, but a production page should not be
linking to a QA environment at all.

**Placeholder text behind unopened steps.** The `@audit` content test reports
`undefined`, `undefined min`, `undefined months` and `Add undefined` rendered
into headings inside the deal builder. They sit in steps the customer has not
opened yet, so they are latent rather than live — which is exactly why the
content sweep separates visible leaks (which fail) from hidden ones (which are
reported). They become live the moment someone reaches that step.

**A typo in a decision-point heading.** The desktop plan configurator reads
"What kind of plan are your looking for?". Not automatable as an assertion, but
worth fixing.

**Interruptions on the critical path**, recorded rather than failed because they
are product decisions, not bugs:

- A "Get a Double Deal!" upsell modal fires between the device and plan steps on
  every device tested.
- The packaged-deal page presents two competing CTAs, and its primary
  "Get this deal" does not add to cart — it redirects into the deal builder at
  `step=addOn`, the configurator a customer chose a packaged deal to avoid.
- Checkout runs a `This deal expires in …` countdown beside the ID number field.
- Upgrade gates every offer behind an SMS OTP, so existing customers cannot see a
  single price without proving they hold the SIM.

---

## CI/CD

`.github/workflows/playwright.yml` runs on push to `main`, on pull requests, every
third day at 06:00 SAST, and on manual dispatch.

1. `npm ci` → `npm run typecheck` → install Chromium
2. `npm test` (both projects, quarantined defects excluded)
3. Re-check `@known-defect` in a `continue-on-error` step
4. Upload the HTML report as a GitHub artifact
5. Publish it to S3 and print the link in the job summary

### AWS report hosting

```bash
./scripts/setup-aws-reports.sh vodacom-suite-reports eu-west-1 Miss-Kay/vodacom-web-framework
```

Creates a public-read S3 static site for reports, the GitHub OIDC provider if it
is missing, and an IAM role scoped to this one repo with write access to the
report bucket only. **The role name is derived from the repo** — two projects in
one AWS account must never share a role, or bootstrapping the second silently
repoints the first repo's trust policy and breaks its pipeline.

The script writes **both** OIDC subject forms into the trust policy — the classic
`repo:owner/name:*` and the immutable `repo:owner@ownerid/name@repoid:*` — because
this GitHub account sends immutable subject IDs, and a policy trusting only the
classic form fails with an opaque `Not authorized to perform
sts:AssumeRoleWithWebIdentity`.

Then set on the repo:

| Kind | Name | Value |
|---|---|---|
| Secret | `AWS_ROLE_ARN` | printed by the script |
| Variable | `REPORT_BUCKET` | `vodacom-suite-reports` |
| Variable | `AWS_REGION` | `eu-west-1` |
| Variable | `REPORT_BASE_URL` | optional, if fronted by CloudFront |
| Variable | `BASE_URL` | optional, to point CI at staging |
| Secret | `SLACK_WEBHOOK_URL` | optional, failure pings |

---

## Maintaining the link baseline

The link checker proves nothing is *broken*. It cannot prove nothing is
*missing* — a page that quietly loses half its navigation passes perfectly,
because every link that remains resolves. So the link set is snapshotted and
diffed; a link present at baseline and absent now fails the run.

New links are reported, never failed. Refresh the snapshot deliberately:

```bash
npm run baseline:update
```

Baseline identity ignores the URL fragment and the campaign parameters listed in
`SiteProfile.volatileQueryParams`. Without that, the header "Log in" link — which
carries a base64 copy of the page you came from — reports itself as one journey
lost and one gained on every single run. Normalising those took the shop home
from 235 "unique" links to 151 real destinations.
