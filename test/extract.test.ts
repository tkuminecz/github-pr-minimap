import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractEvents } from '../src/extract';
import type { TimelineEvent } from '../src/types';

function loadFixture(name: string): Document {
  const html = readFileSync(join(import.meta.dirname, 'fixtures', `${name}.html`), 'utf8');
  return new DOMParser().parseFromString(html, 'text/html');
}

/** Compact one-line description of an event, so whole timelines can be compared as lists. */
function summarize(event: TimelineEvent): string {
  const bot = 'isBot' in event && event.isBot ? '[bot]' : '';
  switch (event.kind) {
    case 'description':
      return `description:${event.author}`;
    case 'comment':
      return `comment:${event.author}${bot}`;
    case 'review':
      return `review:${event.author}${bot}:${event.state}`;
    case 'commit':
      return 'commit';
    case 'force_push':
      return `force_push:${event.author}`;
    case 'milestone':
      return `milestone:${event.milestone}`;
    case 'hidden':
      return `hidden:${event.count}`;
  }
}

const ALL_FIXTURES = ['k8s-long', 'cli-reviews', 'cli-reopened', 'cli-draft', 'next-pushes'];

describe('extractEvents', () => {
  // A PR with no hidden items, so the whole timeline is on the page. The expected list comes from
  // the GitHub GraphQL API for vercel/next.js#99465, not from this parser. It covers bot vs human
  // authors, review states, force-pushes, ready-for-review, and "added N commits" pushes, whose
  // header row must not count as an extra commit. The page differs from the API in two places:
  // the ClosedEvent at merge time is folded into the merge, and two back-to-back force-pushes
  // (12:06 and 13:22 on Oct 1) are shown as a single "force-pushed" row.
  it('reads a full PR timeline in page order', () => {
    const events = extractEvents(loadFixture('next-pushes'));
    expect(events.map(summarize)).toEqual([
      'description:devjiwonchoi',
      'review:vercel[bot]:commented',
      'force_push:devjiwonchoi',
      'comment:github-actions[bot]',
      'milestone:ready_for_review',
      'comment:chatgpt-codex-connector[bot]',
      'review:chatgpt-codex-connector[bot]:commented',
      'force_push:devjiwonchoi',
      'review:vercel[bot]:commented',
      'review:chatgpt-codex-connector[bot]:commented',
      'review:chatgpt-codex-connector[bot]:commented',
      'comment:devjiwonchoi',
      'review:chatgpt-codex-connector[bot]:commented',
      'comment:devjiwonchoi',
      'comment:chatgpt-codex-connector[bot]',
      'review:chatgpt-codex-connector[bot]:commented',
      'comment:devjiwonchoi',
      'comment:chatgpt-codex-connector[bot]',
      'force_push:devjiwonchoi',
      'review:wbinnssmith:commented',
      'review:wbinnssmith:commented',
      'review:wbinnssmith:commented',
      'review:wbinnssmith:approved',
      'force_push:devjiwonchoi',
      'commit',
      'commit',
      'commit',
      'commit',
      'commit',
      'commit',
      'force_push:devjiwonchoi',
      'milestone:merged',
    ]);
  });

  // Closing and reopening are the milestones that tell you a PR was abandoned and revived.
  // Expected list from the API for cli/cli#14294.
  it('reads closed and reopened milestones', () => {
    const events = extractEvents(loadFixture('cli-reopened'));
    expect(events.map(summarize)).toEqual([
      'description:AlexisAMZ',
      'commit',
      'comment:github-actions[bot]',
      'comment:AlexisAMZ',
      'milestone:closed',
      'milestone:reopened',
      'comment:github-actions[bot]',
      'milestone:closed',
    ]);
  });

  // Draft <-> ready transitions are milestones too. Per the API, cli/cli#14320 went
  // ready -> draft -> ready -> merged.
  it('reads draft and ready-for-review milestones in order', () => {
    const events = extractEvents(loadFixture('cli-draft'));
    const milestones = events.flatMap((e) => (e.kind === 'milestone' ? [e.milestone] : []));
    expect(milestones).toEqual(['ready_for_review', 'draft', 'ready_for_review', 'merged']);
  });

  // Review colour depends on the verdict, so the state must come through exactly, with the
  // reviewer and timestamp the API reports for cli/cli#14519.
  it('reads review verdicts with author and time', () => {
    const reviews = extractEvents(loadFixture('cli-reviews')).filter((e) => e.kind === 'review');
    const pick = (state: string) => reviews.find((r) => r.state === state);
    expect(pick('changes_requested')).toMatchObject({
      author: 'BagToad',
      isBot: false,
      time: '2026-09-25T19:22:21Z',
    });
    expect(pick('approved')).toMatchObject({
      author: 'BagToad',
      isBot: false,
      time: '2026-09-29T16:22:58Z',
    });
  });

  // Copilot reviews are shown with an "AI" label instead of "Bot", but they are still automated
  // and should be styled as bots.
  it('treats Copilot reviews as bot reviews', () => {
    const reviews = extractEvents(loadFixture('cli-reviews')).filter((e) => e.kind === 'review');
    const copilot = reviews.filter((r) => r.author === 'Copilot');
    expect(copilot.length).toBeGreaterThan(0);
    expect(copilot.every((r) => r.isBot)).toBe(true);
  });

  // Long PRs hide their middle behind "Load more". That placeholder has to be an event, so it can
  // be auto-loaded (or shown as a marker), and its count comes from the page text.
  it('reads the hidden-items placeholder with its count', () => {
    const events = extractEvents(loadFixture('k8s-long'));
    const hidden = events.filter((e) => e.kind === 'hidden');
    expect(hidden.map(summarize)).toEqual(['hidden:128']);
    expect(hidden[0]?.el.tagName).toBe('FORM');
  });

  // On kubernetes PRs most comments come from the prow bot. Bot status is what lets the minimap
  // dim them, so humans must not be flagged and prow must be.
  it('flags bot comments and not human ones', () => {
    const comments = extractEvents(loadFixture('k8s-long')).filter((e) => e.kind === 'comment');
    const prow = comments.filter((c) => c.author === 'kubernetes-prow');
    const humans = comments.filter((c) => c.author === 'rphillips' || c.author === 'liggitt');
    expect(prow.length).toBeGreaterThan(0);
    expect(humans.length).toBeGreaterThan(0);
    expect(prow.every((c) => c.isBot)).toBe(true);
    expect(humans.some((c) => c.isBot)).toBe(false);
  });

  // The tooltip shows the start of a comment. It should be the comment's own text, whitespace
  // collapsed, not the header ("commented Sep 12") or menu text around it.
  it('takes the snippet from the comment body', () => {
    const events = extractEvents(loadFixture('k8s-long'));
    const comment = events.find(
      (e) => e.kind === 'comment' && e.time === '2026-09-22T17:43:06Z' && e.author === 'liggitt',
    );
    expect(comment).toMatchObject({ snippet: '/lgtm /approve' });
  });

  // Snippets are capped so a huge comment can't blow up the tooltip.
  it('caps snippet length', () => {
    for (const name of ALL_FIXTURES) {
      for (const event of extractEvents(loadFixture(name))) {
        if ('snippet' in event) expect(event.snippet.length).toBeLessThanOrEqual(140);
      }
    }
  });

  // Reviews contain their own inline comment threads. Those threads must roll up into the review,
  // not show up as separate comment markers, and no element may be claimed twice.
  it('never extracts an event nested inside another event', () => {
    for (const name of ALL_FIXTURES) {
      const els = extractEvents(loadFixture(name)).map((e) => e.el);
      for (const el of els) {
        const nested = els.filter((other) => other !== el && el.contains(other));
        expect(nested, `${name}: event nested inside <${el.tagName} id=${el.id}>`).toEqual([]);
      }
    }
  });

  // Markers are laid out top to bottom, so events must come out in page order.
  it('returns events in document order', () => {
    for (const name of ALL_FIXTURES) {
      const els = extractEvents(loadFixture(name)).map((e) => e.el);
      for (let i = 1; i < els.length; i++) {
        const prev = els[i - 1] as Element;
        const following = prev.compareDocumentPosition(els[i] as Element);
        expect(following & Node.DOCUMENT_POSITION_FOLLOWING, `${name} #${i}`).toBeTruthy();
      }
    }
  });

  // Commit rows show no time of their own. The "added N commits" row above them shows when they
  // were pushed, and that's what places them in time (for the quiet-stretch breaks on the line).
  // Commits that came with the PR when it was opened have no such row, so they stay undated.
  it('dates commits by the push that added them', () => {
    const times = (name: string) =>
      extractEvents(loadFixture(name)).flatMap((e) => (e.kind === 'commit' ? [e.time] : []));
    expect(times('next-pushes')).toEqual([
      ...Array(4).fill('2026-10-02T06:04:31+09:00'),
      ...Array(2).fill('2026-10-02T06:04:32+09:00'),
    ]);
    expect(times('k8s-long')).toEqual([null, null]);
  });

  // The content script runs on every github.com page. Off a PR, there's no timeline and it must
  // quietly return nothing.
  it('returns nothing for a page without a PR timeline', () => {
    const doc = new DOMParser().parseFromString('<main><p>repo home</p></main>', 'text/html');
    expect(extractEvents(doc)).toEqual([]);
  });
});
