import type { NodeIcon } from './node-icons';
import type { Entry, Milestone, ReviewState } from './types';

/** Primer colour role for a row's dot. */
export type Tone =
  | 'muted'
  | 'accent'
  | 'success'
  | 'danger'
  | 'attention'
  | 'done'
  | 'open'
  | 'closed';

export interface Description {
  tone: Tone;
  /** The event's icon on the timeline line. */
  icon: NodeIcon;
  /** Shown in bold at the start of the row; null when the row is about the event, not a person. */
  who: string | null;
  /** What happened, short enough for a row: "approved", "3 commits", "Merged". */
  what: string;
  isBot: boolean;
  /** Compact time for the row ("3d"). */
  shortTime: string | null;
  /** Hover text: the full sentence ("amy approved"), long time and extra lines. */
  summary: string;
  time: string | null;
  detail: string;
}

const COMMIT_TITLES_SHOWN = 3;

const REVIEWS: Record<ReviewState, { what: string; tone: Tone; icon: NodeIcon }> = {
  approved: { what: 'approved', tone: 'success', icon: 'thumbs-up' },
  changes_requested: { what: 'requested changes', tone: 'danger', icon: 'file-warning' },
  commented: { what: 'reviewed', tone: 'accent', icon: 'file-text' },
};

const MILESTONES: Record<Milestone, { what: string; verb: string; tone: Tone; icon: NodeIcon }> = {
  merged: { what: 'Merged', verb: 'merged this PR', tone: 'done', icon: 'git-merge' },
  closed: { what: 'Closed', verb: 'closed this PR', tone: 'closed', icon: 'octagon-x' },
  reopened: { what: 'Reopened', verb: 'reopened this PR', tone: 'open', icon: 'rotate-ccw' },
  ready_for_review: {
    what: 'Ready for review',
    verb: 'marked this ready for review',
    tone: 'open',
    icon: 'send',
  },
  draft: {
    what: 'Converted to draft',
    verb: 'converted this to a draft',
    tone: 'muted',
    icon: 'pencil',
  },
};

/** Everything a minimap row and its hover text show for one entry. */
export function describeEntry(entry: Entry, now: Date = new Date()): Description {
  const times = {
    shortTime: entry.time ? shortTime(entry.time, now) : null,
    time: entry.time ? relativeTime(entry.time, now) : null,
  };
  const none = { who: null, isBot: false, detail: '' };

  switch (entry.kind) {
    case 'description':
      return {
        ...none,
        ...times,
        tone: 'muted',
        icon: 'git-pull-request',
        what: 'PR description',
        summary: entry.author ? `${entry.author} opened this PR` : 'PR description',
        detail: entry.snippet,
      };
    case 'comment': {
      const person = { who: entry.author, isBot: entry.isBot };
      return {
        ...person,
        ...times,
        // Bots, and comments GitHub hid as spam, shouldn't stand out.
        tone: entry.isBot || !entry.author ? 'muted' : 'accent',
        icon: !entry.author
          ? 'message-square-dashed'
          : entry.isBot
            ? 'bot-message-square'
            : 'message-square',
        // For bots the dot and "bot" tag already say it; leave the room for the name.
        what: entry.author ? (entry.isBot ? '' : 'commented') : 'Hidden comment',
        summary: entry.author ? `${byline(entry.author, entry.isBot)} commented` : 'Hidden comment',
        detail: entry.snippet,
      };
    }
    case 'review': {
      const review = REVIEWS[entry.state];
      return {
        ...times,
        who: entry.author,
        isBot: entry.isBot,
        // A bot's verdict counts as much as anyone's; only its plain review comments are muted, as
        // are reviews GitHub hid as spam.
        tone: (entry.isBot && entry.state === 'commented') || !entry.author ? 'muted' : review.tone,
        icon: review.icon,
        what: entry.author ? review.what : 'Hidden review',
        summary: entry.author
          ? `${byline(entry.author, entry.isBot)} ${review.what}`
          : 'Hidden review',
        detail: entry.snippet,
      };
    }
    case 'changes': {
      const what = changesLabel(entry.commits.length, entry.forcePushes.length);
      const titles = entry.commits.slice(0, COMMIT_TITLES_SHOWN).map((c) => c.title);
      const more = entry.commits.length - titles.length;
      if (more > 0) titles.push(`…and ${more} more`);
      const forced = entry.forcePushes.length > 0;
      return {
        ...none,
        ...times,
        tone: forced ? 'attention' : 'muted',
        icon: forced ? 'hard-hat' : 'wrench',
        what,
        summary: what,
        detail: titles.join('\n'),
      };
    }
    case 'milestone': {
      const m = MILESTONES[entry.milestone];
      return {
        ...none,
        ...times,
        tone: m.tone,
        icon: m.icon,
        what: m.what,
        summary: entry.author ? `${entry.author} ${m.verb}` : m.what,
      };
    }
    case 'hidden':
      return {
        ...none,
        ...times,
        tone: 'muted',
        icon: 'ellipsis',
        what: `${entry.count} hidden items`,
        summary: `${entry.count} hidden items`,
        detail: 'Click to load them',
      };
  }
}

function byline(author: string, isBot: boolean): string {
  return isBot ? `${author} (bot)` : author;
}

function changesLabel(commits: number, forcePushes: number): string {
  const times = forcePushes > 1 ? ` ${forcePushes}×` : '';
  const commitText = `${commits} commit${commits === 1 ? '' : 's'}`;
  if (forcePushes === 0) return commitText;
  if (commits === 0) return `Force-pushed${times}`;
  return `${commitText}, force-pushed${times}`;
}

const DAY = 24 * 3600;
const UNITS: [Intl.RelativeTimeFormatUnit, string, number][] = [
  ['year', 'y', 365 * DAY],
  ['month', 'mo', 30 * DAY],
  ['week', 'w', 7 * DAY],
  ['day', 'd', DAY],
  ['hour', 'h', 3600],
  ['minute', 'm', 60],
];

/** "3d", "5h", "2mo": fits the time column of a row. */
export function shortTime(iso: string, now: Date = new Date()): string | null {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  return shortDuration(Math.abs(now.getTime() - then) / 1000);
}

/** "3d", "2w": a length of time, as compact as the time column. */
export function shortDuration(seconds: number): string {
  for (const [, suffix, size] of UNITS) {
    if (seconds >= size) return `${Math.floor(seconds / size)}${suffix}`;
  }
  return 'now';
}

const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** "3 days ago", "yesterday": for the hover text. */
export function relativeTime(iso: string, now: Date = new Date()): string | null {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const seconds = (then - now.getTime()) / 1000;
  for (const [unit, , size] of UNITS) {
    if (Math.abs(seconds) >= size) return formatter.format(Math.round(seconds / size), unit);
  }
  return 'now';
}
