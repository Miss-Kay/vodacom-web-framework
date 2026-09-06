import { test, expect } from '@playwright/test';
import { ShopHomePage } from '../pages/ShopHomePage';
import {
  checkLinks,
  formatReport,
  groupByVerdict,
  verifyBlockedInBrowser,
} from '../utils/linkChecker';
import {
  baselineExists,
  diffAgainstBaseline,
  formatDiff,
  isUpdateRun,
  loadBaseline,
  saveBaseline,
  toBaseline,
} from '../utils/linkBaseline';
import { site } from '../fixtures/siteProfile';
import { knownBrokenLinks } from '../fixtures/testData';
import path from 'path';

const BASELINE_PATH = path.join(__dirname, '..', 'fixtures', 'shop-links.baseline.json');

/**
 * LINK INTEGRITY — the shop home page.
 *
 * Two questions, and they are not the same one:
 *
 *   Is anything BROKEN?  Every anchor is resolved over HTTP. Only 404/410 —
 *                        and anything at all on Vodacom's own hosts — fails.
 *                        Third-party bot managers answer automated requests
 *                        with 403 while serving humans perfectly, so those
 *                        are reported as unverified rather than failed.
 *
 *   Is anything MISSING? A page that quietly loses half its navigation
 *                        passes the first check perfectly, because every
 *                        link that remains resolves. So the link set is
 *                        diffed against a committed snapshot, and a link
 *                        that has disappeared fails the run.
 *
 * The shop home is the right page for this: it is where the nav for the
 * whole shop lives, and it spans all four applications a customer crosses
 * in one purchase — /shop, /cloud, /vodacom and vodapay.
 */
test.describe(`${site.name} — shop link integrity`, () => {
  test(`the shop home page resolves and keeps its links @links @smoke`, async ({ page }) => {
    const shop = new ShopHomePage(page);

    await test.step('Step 1 — the shop home page renders', async () => {
      await shop.open(site.paths.shop);
      test.skip(await shop.isBotBlocked(), 'bot-protection page served — skipping');
      await shop.assertLoaded();
    });

    const links = await test.step('Step 2 — collect every link', async () => shop.links());
    expect(links.length, 'the shop home page rendered no links at all').toBeGreaterThan(20);

    await test.step('Step 3 — no malformed hrefs', async () => {
      const malformed = await shop.malformedLinks();
      expect(malformed, `unparseable hrefs found: ${malformed.join(', ')}`).toHaveLength(0);
    });

    await test.step('Step 4 — every link resolves', async () => {
      const apiResults = await checkLinks(page.request, links);
      const results = await verifyBlockedInBrowser(page.context(), apiResults);

      await test.info().attach('link-integrity-report.md', {
        body: formatReport(page.url(), results),
        contentType: 'text/markdown',
      });
      await test.info().attach('link-integrity-results.json', {
        body: JSON.stringify(results, null, 2),
        contentType: 'application/json',
      });

      const grouped = groupByVerdict(results);
      console.info(
        `[LINKS] ok=${grouped.ok.length} broken=${grouped.broken.length} `
          + `unreachable=${grouped.unreachable.length} blocked=${grouped.blocked.length}`,
      );
      for (const result of [...grouped.broken, ...grouped.unreachable, ...grouped.blocked]) {
        console.info(
          `[LINKS] ${result.verdict.toUpperCase()} ${result.status ?? result.detail ?? ''} `
            + `"${result.text || '(no text)'}" → ${result.url}`,
        );
      }

      // A baseline-refresh run captures the link set; it does not gate on link
      // health. Without this, a page that currently has a broken link could
      // never have its snapshot refreshed — the run would fail here first.
      if (isUpdateRun()) return;

      // Split already-reported breakage from new breakage. Only the new
      // kind fails the run; the known kind is echoed every time so it stays
      // visible and nobody mistakes the allowlist for a fix.
      const known = grouped.broken.filter(r => knownBrokenLinks.some(k => k.url.test(r.url)));
      const fresh = grouped.broken.filter(r => !knownBrokenLinks.some(k => k.url.test(r.url)));

      for (const result of known) {
        const entry = knownBrokenLinks.find(k => k.url.test(result.url));
        console.info(`[LINKS] KNOWN BROKEN (${entry?.found}) ${result.url} — ${entry?.note}`);
      }

      await test.info().attach('known-broken-links.md', {
        body:
          `# Known broken links still live\n\n`
          + (known.length === 0
            ? 'None of the allowlisted links are still broken — remove them from '
              + 'fixtures/testData.ts.\n'
            : known
                .map(r => {
                  const entry = knownBrokenLinks.find(k => k.url.test(r.url));
                  return `- ${r.url} (found ${entry?.found}) — ${entry?.note}`;
                })
                .join('\n') + '\n'),
        contentType: 'text/markdown',
      });

      expect(
        fresh,
        `${fresh.length} NEW broken link(s): `
          + fresh.map(r => `${r.status} ${r.url}`).join(', '),
      ).toHaveLength(0);
    });

    await test.step('Step 5 — no link has gone missing since the baseline', async () => {
      if (isUpdateRun()) {
        saveBaseline(BASELINE_PATH, toBaseline(page.url(), links));
        console.info(`[BASELINE] snapshot rewritten with ${links.length} links`);
        return;
      }

      if (!baselineExists(BASELINE_PATH)) {
        test.skip(
          true,
          'No link baseline captured yet. Run: npm run baseline:update',
        );
        return;
      }

      const baseline = loadBaseline(BASELINE_PATH);
      const diff = diffAgainstBaseline(baseline, links);

      await test.info().attach('link-baseline-diff.md', {
        body: formatDiff(baseline, diff, links.length),
        contentType: 'text/markdown',
      });

      for (const link of diff.missing) {
        console.info(`[BASELINE] MISSING "${link.text || '(no text)'}" → ${link.key}`);
      }
      for (const link of diff.added) {
        console.info(`[BASELINE] NEW     "${link.text || '(no text)'}" → ${link.key}`);
      }

      expect(
        diff.missing,
        `${diff.missing.length} link(s) present at baseline are gone from the page — `
          + 'those journeys can no longer be reached from the shop home.',
      ).toHaveLength(0);
    });
  });
});
