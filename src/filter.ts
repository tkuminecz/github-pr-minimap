import type { TimelineEvent } from './types';

export interface FilterOptions {
  /** The signed-in user's login, or null when signed out. */
  viewer: string | null;
  /** Bots whose comments and reviews only show on PRs the viewer opened. */
  botsOnlyOnOwnPRs: string[];
  /** Bots whose comments and reviews never show. */
  hiddenBots: string[];
}

/**
 * Leaves out comments and reviews from bots that are noise: `hiddenBots` always, and
 * `botsOnlyOnOwnPRs` unless the viewer opened the PR. The PR's author is whoever wrote its
 * description. Bot logins are matched in any case.
 */
export function filterEvents(events: TimelineEvent[], options: FilterOptions): TimelineEvent[] {
  const author = events.find((e) => e.kind === 'description')?.author;
  const own = !!author && !!options.viewer && same(author, options.viewer);
  const hidden = new Set(
    [...options.hiddenBots, ...(own ? [] : options.botsOnlyOnOwnPRs)].map((n) => n.toLowerCase()),
  );
  if (hidden.size === 0) return events;

  return events.filter(
    (e) =>
      !(
        (e.kind === 'comment' || e.kind === 'review') &&
        e.isBot &&
        e.author &&
        hidden.has(e.author.toLowerCase())
      ),
  );
}

/** The signed-in user's login, from the meta tag GitHub puts on every page; null when signed out. */
export function currentViewer(doc: Document): string | null {
  return doc.querySelector('meta[name="user-login"]')?.getAttribute('content') || null;
}

/** GitHub logins are case-insensitive. */
function same(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
