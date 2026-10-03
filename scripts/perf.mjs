// Performance check: loads the built extension (dist/) on a long PR, then measures what it costs
// while the pointer sweeps along the timeline (magnification), while the page scrolls, and while
// the page sits idle (GitHub keeps mutating its DOM). Run `pnpm build` first.
// Usage: node scripts/perf.mjs [pr-url] [--without]   (--without: same run with no extension,
// to see how much of the cost is GitHub's own page)
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const PR_URL =
  process.argv.slice(2).find((a) => !a.startsWith('--')) ??
  'https://github.com/kubernetes/kubernetes/pull/142046';
const WITHOUT = process.argv.includes('--without');
const EXTENSION = resolve('dist');

const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1440, height: 900 },
  args: WITHOUT
    ? []
    : [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
});
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('Performance.enable');

async function metrics() {
  const { metrics } = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
}

/** Runs `action` and reports Chrome's own counters for it, plus frame timings. */
async function measure(name, action) {
  await page.evaluate(() => {
    window.__frames = [];
    let last = performance.now();
    const loop = (now) => {
      window.__frames.push(now - last);
      last = now;
      if (window.__frames.length < 100_000) window.__raf = requestAnimationFrame(loop);
    };
    window.__raf = requestAnimationFrame(loop);
  });
  const before = await metrics();
  await action();
  const after = await metrics();
  const frames = await page.evaluate(() => {
    cancelAnimationFrame(window.__raf);
    return window.__frames.slice(1);
  });
  const sorted = [...frames].sort((a, b) => a - b);
  const delta = (k) => after[k] - before[k];
  console.log(
    `${name.padEnd(10)} script ${(delta('ScriptDuration') * 1000).toFixed(0).padStart(5)}ms` +
      `  layout ${(delta('LayoutDuration') * 1000).toFixed(0).padStart(4)}ms (${delta('LayoutCount')} layouts)` +
      `  style ${(delta('RecalcStyleDuration') * 1000).toFixed(0).padStart(4)}ms` +
      `  frames p95 ${(sorted[Math.floor(sorted.length * 0.95)] ?? 0).toFixed(1)}ms` +
      ` max ${(sorted.at(-1) ?? 0).toFixed(1)}ms, ${frames.filter((f) => f > 34).length} over 34ms`,
  );
}

try {
  await page.goto(PR_URL, { waitUntil: 'domcontentloaded' });
  let line = { x: 1395, y: 136, width: 24, height: 540 }; // where the timeline sits at 1440x900
  if (!WITHOUT) {
    await page.locator('pr-minimap').waitFor({ state: 'attached', timeout: 20_000 });
    const deadline = Date.now() + 45_000;
    while ((await page.locator('form.js-ajax-pagination').count()) && Date.now() < deadline) {
      await page.waitForTimeout(500);
    }
    line = (await page.locator('pr-minimap .line-zone').boundingBox()) ?? line;
  }
  await page.waitForTimeout(1500);
  console.log(
    WITHOUT
      ? `no extension, ${PR_URL}`
      : `${await page.locator('pr-minimap .dot').count()} dots on ${PR_URL}`,
  );
  await measure('hover', async () => {
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i <= 60; i++) {
        const f = pass % 2 ? 1 - i / 60 : i / 60;
        await page.mouse.move(line.x + line.width / 2, line.y + line.height * f);
        await page.waitForTimeout(16);
      }
    }
  });
  await page.mouse.move(300, 450);
  await page.waitForTimeout(500);

  await measure('scroll', async () => {
    for (let i = 0; i < 80; i++) {
      await page.mouse.wheel(0, i < 40 ? 120 : -120);
      await page.waitForTimeout(16);
    }
  });

  await measure('idle 5s', () => page.waitForTimeout(5000));
} finally {
  await context.close();
}
