import type { TimelineEvent } from './types';

export interface FilterOptions {
  /** The signed-in user's login, or null when signed out. */
  viewer: string | null;
  /** Bots whose comments and reviews only show on PRs the viewer opened. */
  botsOnlyOnOwnPRs: string[];
  /** Bots whose comments and reviews never show. */
  hiddenBots: string[];
  /** Bots whose approvals show, but none of their comments or other reviews. */
  approvalsOnlyBots: string[];
}

/**
 * Leaves out comments and reviews from bots that are noise: `hiddenBots` always,
 * `botsOnlyOnOwnPRs` unless the viewer opened the PR, and everything but the approvals of
 * `approvalsOnlyBots`. The PR's author is whoever wrote its description. Bot logins are matched in
 * any case.
 */
export function filterEvents(events: TimelineEvent[], options: FilterOptions): TimelineEvent[] {
  const author = events.find((e) => e.kind === 'description')?.author;
  const own = !!author && !!options.viewer && same(author, options.viewer);
  const lower = (names: string[]) => new Set(names.map((n) => n.toLowerCase()));
  const hidden = lower([...options.hiddenBots, ...(own ? [] : options.botsOnlyOnOwnPRs)]);
  const approvalsOnly = lower(options.approvalsOnlyBots);

  return events.filter((e) => {
    if ((e.kind !== 'comment' && e.kind !== 'review') || !e.isBot || !e.author) return true;
    const bot = e.author.toLowerCase();
    if (hidden.has(bot)) return false;
    return !approvalsOnly.has(bot) || (e.kind === 'review' && e.state === 'approved');
  });
}

/** The signed-in user's login, from the meta tag GitHub puts on every page; null when signed out. */
export function currentViewer(doc: Document): string | null {
  return doc.querySelector('meta[name="user-login"]')?.getAttribute('content') || null;
}

/** GitHub logins are case-insensitive. */
function same(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
