import { Page } from '@playwright/test';

/**
 * CONTENT INTEGRITY — placeholder leak detection
 * ---------------------------------------------
 * A link checker proves the customer can get somewhere. It says nothing
 * about what they find when they arrive.
 *
 * The failure this catches is the one a screenshot-based smoke test sails
 * straight past: the page renders, returns 200, every link resolves — and a
 * heading says "undefined months". The template bound to a value that was
 * never set, JavaScript stringified it, and it shipped. Nobody notices
 * because no assertion was ever written for text that isn't supposed to
 * exist.
 *
 * On Vodacom's deal builder this finds, live in production today:
 *   <h3>undefined</h3>, "undefined  min", "undefined  months", "Add undefined"
 * and on the upgrade page, headings rendering a bare "-".
 *
 * Why it earns its place next to the link checker: both answer "is the page
 * quietly rotting?", and both fail on absence rather than error.
 */

export type LeakKind =
  | 'undefined'      // the literal string "undefined"
  | 'null'           // the literal string "null"
  | 'NaN'            // a failed number coercion, usually in a price
  | 'object'         // "[object Object]"
  | 'template'       // an unrendered {{ handlebars }} or ${ template literal }
  | 'empty-heading'; // a heading rendering nothing, or only punctuation

export interface ContentLeak {
  kind: LeakKind;
  /** The rendered text as the customer sees it. */
  text: string;
  /** Tag name and classes, so the leak can be found in the codebase. */
  selector: string;
  /** Heading, button, link, or generic — headings and buttons hurt most. */
  role: string;
  /** True when the element is actually on screen for a customer. */
  visible: boolean;
}

/**
 * Word-boundary matches on LEAF elements only.
 *
 * Both halves matter. Matching substrings would flag legitimate prose
 * ("an undefined number of..."), and matching non-leaf elements would report
 * every ancestor of one leak as a separate finding — a single <h3>undefined</h3>
 * would surface as a dozen hits climbing the tree to <body>.
 */
const LEAK_PATTERNS: { kind: LeakKind; test: RegExp }[] = [
  { kind: 'undefined', test: /(^|\s)undefined(\s|$)/ },
  { kind: 'null', test: /(^|\s)null(\s|$)/ },
  { kind: 'NaN', test: /(^|\s)NaN(\s|$)/ },
  { kind: 'object', test: /\[object [A-Z]\w*\]/ },
  { kind: 'template', test: /\{\{\s*\w[\w.\s|]*\}\}|\$\{\s*\w[\w.\s]*\}/ },
];

/**
 * Collect every placeholder that leaked into rendered text.
 *
 * `includeHidden` defaults to false: a leak inside a modal the customer
 * never opens is a latent bug, not a live one, and mixing the two makes the
 * report impossible to triage. Pass true to audit the whole DOM — Vodacom's
 * deal builder renders every step and every modal into one document, so the
 * hidden set is large and genuinely interesting during development.
 */
export async function collectContentLeaks(
  page: Page,
  options: { includeHidden?: boolean } = {},
): Promise<ContentLeak[]> {
  const includeHidden = options.includeHidden ?? false;

  const raw = await page.evaluate(() => {
    const HEADINGS = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
    const out: {
      text: string;
      selector: string;
      role: string;
      visible: boolean;
      isHeading: boolean;
    }[] = [];

    for (const element of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      // Leaf elements only — see the comment on LEAK_PATTERNS.
      if (element.children.length > 0) continue;
      if (element.tagName === 'SCRIPT' || element.tagName === 'STYLE') continue;

      const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (!text || text.length > 120) continue; // long prose is not a placeholder

      const classes = (element.className ?? '').toString().replace(/\s+/g, '.').slice(0, 60);
      const closest = element.closest('h1,h2,h3,h4,h5,h6,button,a,label');
      const role = HEADINGS.has(element.tagName)
        ? 'heading'
        : closest
          ? closest.tagName.toLowerCase()
          : 'text';

      out.push({
        text,
        selector: `${element.tagName.toLowerCase()}${classes ? `.${classes}` : ''}`,
        role,
        // offsetParent is null for display:none and for anything inside it —
        // the cheapest reliable "is this actually on screen" test there is.
        visible: element.offsetParent !== null,
        isHeading: HEADINGS.has(element.tagName),
      });
    }
    return out;
  });

  const leaks: ContentLeak[] = [];

  for (const node of raw) {
    if (!includeHidden && !node.visible) continue;

    const matched = LEAK_PATTERNS.find(pattern => pattern.test.test(node.text));
    if (matched) {
      leaks.push({ kind: matched.kind, ...node });
      continue;
    }

    // A heading rendering only punctuation is the same bug wearing a
    // different coat: the value was empty rather than undefined, so the
    // template emitted its separator and nothing else.
    if (node.isHeading && /^[-–—:|.]+$/.test(node.text)) {
      leaks.push({ kind: 'empty-heading', ...node });
    }
  }

  return leaks;
}

/** Group leaks by kind, for assertions and reporting. */
export function groupByKind(leaks: ContentLeak[]): Record<string, ContentLeak[]> {
  const grouped: Record<string, ContentLeak[]> = {};
  for (const leak of leaks) (grouped[leak.kind] ??= []).push(leak);
  return grouped;
}

/**
 * Leaks in a heading, button, or label are customer-facing copy defects and
 * fail the run. A leak in incidental text is reported but tolerated — the
 * distinction keeps the suite worth reading.
 */
export function isCustomerFacing(leak: ContentLeak): boolean {
  return leak.role === 'heading' || leak.role === 'button' || leak.role === 'label';
}

/** A readable report, attached to the test so it lands in the HTML report. */
export function formatLeakReport(pageName: string, pageUrl: string, leaks: ContentLeak[]): string {
  const lines: string[] = [
    `# Content integrity — ${pageName}`,
    '',
    pageUrl,
    '',
  ];

  if (leaks.length === 0) {
    lines.push('No placeholder text leaked into the rendered page.', '');
    return lines.join('\n');
  }

  const blocking = leaks.filter(isCustomerFacing);
  lines.push(
    `${leaks.length} placeholder leak(s) found — `
      + `${blocking.length} in headings/buttons/labels (blocking), `
      + `${leaks.length - blocking.length} in incidental text (reported only)`,
    '',
  );

  const grouped = groupByKind(leaks);
  for (const [kind, items] of Object.entries(grouped)) {
    lines.push(`## ${kind} (${items.length})`, '');
    for (const item of items) {
      lines.push(
        `- ${isCustomerFacing(item) ? '**BLOCKING**' : 'reported'} `
          + `[${item.role}] "${item.text}" — \`${item.selector}\``,
      );
    }
    lines.push('');
  }

  return lines.join('\n');
}
