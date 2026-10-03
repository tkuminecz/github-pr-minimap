// End-to-end smoke test: loads the built extension (dist/) into Chromium, opens a live PR and
// checks the activity timeline appears with readable labels, auto-loads hidden items, scrolls on click,
// hides with the eye, and disappears on other tabs. Run `pnpm build` first.
// Usage: node scripts/smoke.mjs [pr-url] [screenshot-dir]
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const PR_URL = process.argv[2] ?? 'https://github.com/kubernetes/kubernetes/pull/142046';
const SHOTS = resolve(process.argv[3] ?? 'smoke-output');
const EXTENSION = resolve('dist');
const WIDTH = 1440;
const HEIGHT = Number(process.env.SMOKE_HEIGHT ?? 900);

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

await mkdir(SHOTS, { recursive: true });
const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: true,
  viewport: { width: WIDTH, height: HEIGHT },
  args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
});
const page = await context.newPage();

try {
  await page.goto(PR_URL, { waitUntil: 'domcontentloaded' });
  const host = page.locator('pr-minimap');
  await host.waitFor({ state: 'attached', timeout: 20_000 });
  check('list appears on the Conversation tab', true);

  const dots = page.locator('pr-minimap .dot');
  const hiddenForms = () => page.locator('form.js-ajax-pagination').count();
  const before = await dots.count();
  const formsAtStart = await hiddenForms();

  // Auto-load: every "Load more" form should be consumed and no hidden-items entry left. The entry
  // count can go either way: loaded pushes merge into neighbouring change entries, and loaded label
  // events aren't entries at all.
  const deadline = Date.now() + 45_000;
  while ((await hiddenForms()) > 0 && Date.now() < deadline) await page.waitForTimeout(500);
  await page.waitForTimeout(800); // let the throttled sync catch up
  const after = await dots.count();
  const hiddenRows = await page.locator('pr-minimap .dot[aria-label*="hidden items"]').count();
  check(
    'hidden items are auto-loaded',
    (await hiddenForms()) === 0 && hiddenRows === 0,
    `${formsAtStart} "Load more" form(s) at start, entries ${before} -> ${after}`,
  );

  // Readable without hovering: the labels shown all have text, and their connectors fan out.
  const labels = await page
    .locator('pr-minimap .label:not([hidden])')
    .evaluateAll((ls) => ls.map((l) => l.textContent?.trim() ?? ''));
  check(
    'labels are shown with text',
    labels.length > 0 && labels.every((l) => l.length > 0),
    `${labels.length} labels for ${after} dots, e.g. ${JSON.stringify(labels.slice(0, 4))}`,
  );
  // Connectors are angled like branches: pulled in toward the middle where dots are spread out,
  // fanning apart where dots crowd together.
  const connectors = await page.locator('pr-minimap .connectors path').evaluateAll((ps) =>
    ps.map((p) => {
      const n = (p.getAttribute('d') ?? '').match(/-?[\d.]+/g)?.map(Number) ?? [];
      return Math.abs((n[1] ?? 0) - (n.at(-1) ?? 0));
    }),
  );
  const dotPitch =
    after > 1 ? Math.min((HEIGHT * 0.6) / (after - 1), 32) : Number.POSITIVE_INFINITY;
  check(
    'connectors are angled',
    connectors.filter((d) => d > 2).length >= connectors.length / 2,
    `${connectors.filter((d) => d > 2).length}/${connectors.length} angled, dots ${dotPitch.toFixed(1)}px apart`,
  );

  const box = await host.boundingBox();
  check(
    'list sits at the right edge and fits on screen',
    !!box && box.x + box.width > WIDTH - 40 && box.y + box.height <= HEIGHT,
    JSON.stringify(box),
  );
  // Quiet stretches of a day or more break the line, halfway between the events either side,
  // and each break adds 16px to a short line.
  const quiet = await page.locator('pr-minimap').evaluate((h) => {
    const root = h.shadowRoot;
    const ys = [...root.querySelectorAll('.dot:not([hidden])')].map((d) => {
      const r = d.getBoundingClientRect();
      return r.top + r.height / 2;
    });
    return [...root.querySelectorAll('.break')].map((b) => {
      const y = b.getBoundingClientRect().top;
      return {
        label: b.textContent,
        between: ys.some((top, i) => top < y && (ys[i + 1] ?? 0) > y),
      };
    });
  });
  check(
    'quiet stretches break the line between events',
    quiet.every((q) => q.between),
    quiet.length ? quiet.map((q) => q.label).join(' ') : 'none on this PR',
  );

  const lineHeight = (await page.locator('pr-minimap .line').boundingBox())?.height ?? 0;
  const expectedLine = Math.min(HEIGHT * 0.6, (after - 1) * 32 + quiet.length * 16);
  check(
    'the line runs 60% of the window, or shorter with dots 32px apart',
    after < 2 || Math.abs(lineHeight - expectedLine) < 2,
    `${lineHeight}px for ${after} dots`,
  );

  // Each event is drawn as its icon, unless they're too close together for icons to fit.
  const nodes = await page.locator('pr-minimap .timeline').evaluate((t) => {
    const dots = [...t.querySelectorAll('.dot:not([hidden])')];
    const ys = dots.map((d) => d.getBoundingClientRect().top);
    const closest = Math.min(...ys.slice(1).map((y, i) => y - ys[i]));
    const icons = dots.filter(
      (d) => (d.querySelector('.glyph')?.getBoundingClientRect().width ?? 0) > 0,
    );
    return {
      compact: t.classList.contains('compact'),
      closest,
      icons: icons.length,
      dots: dots.length,
    };
  });
  check(
    'events show as icons, or plain dots when crowded',
    nodes.compact ? nodes.closest < 16 && nodes.icons === 0 : nodes.icons === nodes.dots,
    JSON.stringify(nodes),
  );

  // No box: clicks between the labels reach GitHub's page underneath.
  const clickThrough = await page.evaluate(() => {
    const root = document.querySelector('pr-minimap')?.shadowRoot;
    const host = document.querySelector('pr-minimap')?.getBoundingClientRect();
    const labels = [...(root?.querySelectorAll('.label') ?? [])].filter((l) => !l.hidden);
    if (!host || labels.length < 2) return null;
    const boxes = labels.map((l) => l.getBoundingClientRect());
    for (let i = 1; i < boxes.length; i++) {
      const gap = (boxes[i]?.top ?? 0) - (boxes[i - 1]?.bottom ?? 0);
      if (gap > 4) {
        const y = ((boxes[i]?.top ?? 0) + (boxes[i - 1]?.bottom ?? 0)) / 2;
        return document.elementFromPoint(host.left + 10, y)?.tagName ?? 'none';
      }
    }
    // Labels packed edge to edge: test the empty area left of the shortest label instead.
    const narrowest = boxes.reduce((a, b) => (b.width < a.width ? b : a));
    return (
      document.elementFromPoint(host.left + 4, narrowest.top + narrowest.height / 2)?.tagName ??
      'none'
    );
  });
  check(
    'empty space around the timeline lets clicks through to the page',
    clickThrough !== null && clickThrough !== 'PR-MINIMAP',
    `element under the gap: ${clickThrough}`,
  );

  // The bundled fonts load despite GitHub's content security policy.
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return {
      sans: document.fonts.check('600 12px "PR Minimap Plex Sans Condensed"'),
      mono: document.fonts.check('300 12px "PR Minimap Plex Mono"'),
    };
  });
  check('the bundled fonts load', fonts.sans && fonts.mono, JSON.stringify(fonts));

  const repoHeaderClear = await page.evaluate(() => {
    const star = document.querySelector('[data-hydro-click*="star_button"], .starring-container');
    const host = document.querySelector('pr-minimap');
    if (!star || !host) return true;
    return star.getBoundingClientRect().bottom <= host.getBoundingClientRect().top;
  });
  check('list does not cover the repo header at the top of the page', repoHeaderClear);
  await page.screenshot({ path: `${SHOTS}/1-conversation.png` });

  // Click: page scrolls to the item, and its label is highlighted as on screen.
  const target = page.locator('pr-minimap .label:not([hidden])').nth(Math.floor(labels.length / 2));
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await target.click();
  await page.waitForTimeout(1_500);
  await page.mouse.move(400, 400); // leave the list so it can follow the page again
  await page.waitForTimeout(300);
  const scrollAfter = await page.evaluate(() => window.scrollY);
  check(
    'clicking a label scrolls the page',
    scrollAfter !== scrollBefore,
    `${scrollBefore} -> ${scrollAfter}`,
  );
  check(
    'the clicked label is highlighted as on screen',
    await target.evaluate((r) => r.classList.contains('on-screen')),
  );
  await page.screenshot({ path: `${SHOTS}/2-after-click.png` });

  // Long PRs: at the bottom of the page, the labelled section has followed to the last entry.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(800);
  const followed = await page
    .locator('pr-minimap .label')
    .last()
    .evaluate((l) => !l.hidden);
  check('the labels follow the page to the bottom', followed);
  await page.screenshot({ path: `${SHOTS}/3-bottom.png` });

  // Hovering magnifies around the pointer like the macOS Dock: the nearby dots grow and spread
  // apart. Which events are labelled must not change (it used to, which made labels jump).
  const labelledSet = () =>
    page
      .locator('pr-minimap .label')
      .evaluateAll((ls) => ls.map((l) => (l.hidden ? '-' : l.dataset.index)).join(','));
  const largestDot = () =>
    page
      .locator('pr-minimap .dot')
      .evaluateAll((ds) =>
        Math.max(...ds.map((d) => Number(d.style.getPropertyValue('--m') || 1))),
      );
  const beforeHover = await labelledSet();
  const line = await page.locator('pr-minimap .line-zone').boundingBox();
  if (line) {
    for (const f of [0.3, 0.45, 0.5]) {
      await page.mouse.move(line.x + line.width / 2, line.y + line.height * f);
      await page.waitForTimeout(120);
    }
    await page.waitForTimeout(300);
  }
  const magnified = await largestDot();
  check(
    'hovering the timeline magnifies it, subtly',
    magnified > 1.3 && magnified < 1.6,
    `largest dot ${magnified}x`,
  );
  const magnifiedLine = (await page.locator('pr-minimap .line').boundingBox())?.height ?? 0;
  check(
    'the line keeps its length while magnified',
    Math.abs(magnifiedLine - lineHeight) < 2,
    `${lineHeight}px -> ${magnifiedLine}px`,
  );
  check(
    'hovering does not change which events are labelled',
    (await labelledSet()) === beforeHover,
  );
  await page.screenshot({ path: `${SHOTS}/3b-dock.png` });
  await page.mouse.move(300, 450);
  await page.waitForTimeout(500);
  check('moving away settles it back', (await largestDot()) === 1);

  // Hover is optional but still shows detail.
  await page.locator('pr-minimap .label:not([hidden])').last().hover();
  const tooltip = page.locator('pr-minimap .tooltip');
  await tooltip.waitFor({ state: 'visible', timeout: 2_000 }).catch(() => {});
  check('hovering a label shows detail', await tooltip.isVisible());
  await page.screenshot({ path: `${SHOTS}/4-tooltip.png` });

  // While the timeline is magnified from near its bottom, the top dots get pushed up toward the eye.
  // The eye must still be the thing under the pointer, or it can't be clicked.
  const lineBox = await page.locator('pr-minimap .line-zone').boundingBox();
  if (lineBox) {
    await page.mouse.move(lineBox.x + lineBox.width / 2, lineBox.y + lineBox.height * 0.95);
    await page.waitForTimeout(400);
  }
  const eyeOnTop = await page.evaluate(() => {
    const root = document.querySelector('pr-minimap')?.shadowRoot;
    const eyeEl = root?.querySelector('.eye');
    if (!root || !eyeEl) return 'no eye';
    const r = eyeEl.getBoundingClientRect();
    const hit = root.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit && eyeEl.contains(hit) ? 'eye' : (hit?.className ?? 'nothing');
  });
  check('the eye stays clickable while the timeline is magnified', eyeOnTop === 'eye', eyeOnTop);

  // The eye fades the whole timeline out, leaving just the eye, and fades it back in.
  const eye = page.locator('pr-minimap .eye');
  const timeline = page.locator('pr-minimap .timeline');
  const opacity = () => timeline.evaluate((t) => Number(getComputedStyle(t).opacity));
  await eye.click();
  await page.waitForTimeout(60);
  const midFade = await opacity();
  await page.screenshot({ path: `${SHOTS}/5a-fading.png` });
  await page.waitForTimeout(400);
  check('hiding fades out rather than vanishing', midFade > 0 && midFade < 1, `opacity ${midFade}`);
  check('the eye hides the timeline', !(await timeline.isVisible()) && (await eye.isVisible()));
  await page.screenshot({ path: `${SHOTS}/5-hidden.png` });
  await eye.click();
  await page.waitForTimeout(400);
  check('the eye shows it again', await timeline.isVisible());

  // Soft navigation to another tab: the list must go away, and come back on return.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('a[href$="/files"], a[href$="/changes"]').first().click();
  await page.waitForURL(/\/(files|changes)$/, { timeout: 20_000 });
  await page.waitForTimeout(1_000);
  check('list disappears on the Files changed tab', (await host.count()) === 0);

  await page.goBack();
  await page.waitForURL(/\/pull\/\d+$/, { timeout: 20_000 });
  const back = await host
    .waitFor({ state: 'attached', timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  check('list comes back on returning to the Conversation tab', back);
  check('only one list is mounted', (await host.count()) === 1, `${await host.count()}`);
} finally {
  await context.close();
}

const failed = results.filter((r) => !r.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} checks passed. Screenshots: ${SHOTS}`,
);
process.exit(failed.length ? 1 : 0);
