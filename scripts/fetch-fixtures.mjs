// Downloads real GitHub PR conversation pages (logged-out view) and saves just the timeline
// markup as test fixtures. Re-run after GitHub changes its markup: `pnpm fixtures`.
import { writeFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

// Each PR was picked because it exercises specific timeline events.
const FIXTURES = {
  // Long PR: bot comments, "commented" reviews, force-push, labels, 128 hidden items.
  'k8s-long': 'https://github.com/kubernetes/kubernetes/pull/142046',
  // "Changes requested" + approved reviews, Copilot ("AI") reviews, merged.
  'cli-reviews': 'https://github.com/cli/cli/pull/14519',
  // Closed, reopened, closed again.
  'cli-reopened': 'https://github.com/cli/cli/pull/14294',
  // Converted to draft, marked ready for review, merged.
  'cli-draft': 'https://github.com/cli/cli/pull/14320',
  // "added N commits" pushes, force-push, auto-merge events, merged.
  'next-pushes': 'https://github.com/vercel/next.js/pull/99465',
};

async function fetchFixture(name, url) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 github-pr-minimap-fixtures' },
  });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const { document } = new JSDOM(await res.text()).window;

  const timeline = document.querySelector('.pull-discussion-timeline');
  if (!timeline) throw new Error(`${url}: no .pull-discussion-timeline (markup changed?)`);

  // Shrink the fixture: icon path data, scripts and styles carry no signal for the parser.
  for (const el of timeline.querySelectorAll('svg path, script, style')) el.remove();

  const html = `<!-- ${url} fetched ${new Date().toISOString().slice(0, 10)} -->\n${timeline.outerHTML}\n`;
  await writeFile(new URL(`../test/fixtures/${name}.html`, import.meta.url), html);
  console.log(`${name}: ${(html.length / 1024).toFixed(0)} KB`);
}

for (const [name, url] of Object.entries(FIXTURES)) await fetchFixture(name, url);
