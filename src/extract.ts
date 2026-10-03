import type { Milestone, ReviewState, TimelineEvent } from './types';

const SNIPPET_LENGTH = 140;

// Every `.js-timeline-item` carries a GraphQL node id whose prefix names its type
// (IC_ = IssueComment, PRR_ = PullRequestReview, ...). Condensed events (pushes, merges, labels)
// get bundled several to an item, so those are told apart by their badge icon instead.
const COMMENT_PREFIX = 'IC_';
const REVIEW_PREFIX = 'PRR_';

/**
 * Reads the PR conversation timeline into events, in page order.
 * Returns [] when `root` has no PR timeline (any non-conversation page).
 */
export function extractEvents(root: ParentNode): TimelineEvent[] {
  const discussion = root.querySelector('.js-discussion');
  if (!discussion) return [];

  const events: TimelineEvent[] = [];

  const description = discussion.querySelector('.js-command-palette-pull-body');
  if (description) {
    const header = headerOf(description);
    events.push({
      kind: 'description',
      el: description,
      author: authorName(header),
      time: timeIn(header),
      snippet: snippetIn(description),
    });
  }

  for (const node of discussion.querySelectorAll('.js-timeline-item, form.js-ajax-pagination')) {
    // Guard against GitHub ever nesting items: the outer item owns everything inside it.
    if (node.parentElement?.closest('.js-timeline-item')) continue;

    if (node.matches('form')) {
      events.push(hiddenEvent(node));
    } else {
      events.push(...itemEvents(node));
    }
  }
  return events;
}

function itemEvents(item: Element): TimelineEvent[] {
  const gid = item.getAttribute('data-gid') ?? '';

  if (gid.startsWith(COMMENT_PREFIX)) {
    const header = headerOf(item);
    return [
      {
        kind: 'comment',
        el: item,
        author: authorName(header),
        isBot: isBot(header),
        time: timeIn(header),
        snippet: snippetIn(item),
      },
    ];
  }

  if (gid.startsWith(REVIEW_PREFIX)) {
    // The review's first TimelineItem is its header row ("X approved these changes").
    const header = item.querySelector('.TimelineItem');
    return [
      {
        kind: 'review',
        el: item,
        author: authorName(header),
        isBot: isBot(header),
        time: timeIn(header),
        state: reviewState(header),
        snippet: snippetIn(item),
      },
    ];
  }

  return [...item.querySelectorAll('.TimelineItem')].flatMap(condensedEvent);
}

function condensedEvent(row: Element): TimelineEvent[] {
  const icon = badgeIcon(row);
  if (!icon) return [];

  const body = row.querySelector(':scope > .TimelineItem-body') ?? row;
  const text = normalize(body.textContent);
  const base = { el: row, author: authorName(body), time: timeIn(body) };

  if (icon === 'git-commit') {
    const title = normalize(row.querySelector('.markdown-title')?.textContent);
    return [{ kind: 'commit', ...base, title }];
  }
  // The same push icon heads "added N commits" rows; the commits below it are the real events.
  if (icon === 'repo-push') {
    return /\bforce-pushed\b/.test(text) ? [{ kind: 'force_push', ...base }] : [];
  }

  const milestone = milestoneOf(icon, text);
  return milestone ? [{ kind: 'milestone', ...base, milestone }] : [];
}

function milestoneOf(icon: string, text: string): Milestone | null {
  // Several icons are shared with unrelated events (the PR icon also marks auto-merge changes),
  // so each milestone needs its icon AND its wording.
  if (icon === 'git-merge' && /\bmerged\b/.test(text)) return 'merged';
  if (icon === 'git-pull-request-closed' && /\bclosed this\b/.test(text)) return 'closed';
  if (icon === 'git-pull-request' && /\breopened this\b/.test(text)) return 'reopened';
  if (icon === 'git-pull-request-draft' && /\bas draft\b/.test(text)) return 'draft';
  if (icon === 'eye' && /\bready for review\b/.test(text)) return 'ready_for_review';
  return null;
}

function reviewState(header: Element | null): ReviewState {
  const icon = header ? badgeIcon(header) : null;
  if (icon === 'check') return 'approved';
  if (icon === 'file-diff') return 'changes_requested';
  return 'commented';
}

function hiddenEvent(form: Element): TimelineEvent {
  const match = normalize(form.textContent).match(/([\d,]+) hidden items?/);
  const count = match?.[1] ? Number.parseInt(match[1].replaceAll(',', ''), 10) : 0;
  return { kind: 'hidden', el: form, author: null, time: null, count };
}

/** Octicon name of a TimelineItem's own badge, e.g. "git-merge". */
function badgeIcon(row: Element): string | null {
  const svg = row.querySelector(':scope > .TimelineItem-badge svg');
  const cls = [...(svg?.classList ?? [])].find((c) => c.startsWith('octicon-'));
  return cls ? cls.slice('octicon-'.length) : null;
}

function headerOf(el: Element): Element | null {
  return el.querySelector('.timeline-comment-header');
}

function authorName(scope: Element | null): string | null {
  const name = normalize(scope?.querySelector('a.author')?.textContent);
  return name || null;
}

/** Bot accounts link to /apps/...; GitHub labels them "Bot", or "AI" for Copilot. */
function isBot(scope: Element | null): boolean {
  const author = scope?.querySelector('a.author');
  if (!author) return false;
  if (author.getAttribute('href')?.startsWith('/apps/')) return true;
  const labels = author.parentElement?.querySelectorAll('.Label') ?? [];
  return [...labels].some((l) => /^(Bot|AI)$/.test(normalize(l.textContent)));
}

function timeIn(scope: Element | null): string | null {
  return scope?.querySelector('relative-time[datetime]')?.getAttribute('datetime') ?? null;
}

function snippetIn(scope: Element): string {
  const text = normalize(scope.querySelector('.comment-body')?.textContent);
  return text.length > SNIPPET_LENGTH ? `${text.slice(0, SNIPPET_LENGTH - 1)}…` : text;
}

function normalize(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}
