import { describeEntry, relativeTime, shortTime } from '../src/describe';
import type { ChangesGroup, CommitEvent, Entry, ForcePushEvent, ReviewState } from '../src/types';

const el = () => document.createElement('div');
const NOW = new Date('2026-10-02T12:00:00Z');

const commit = (title: string): CommitEvent => ({
  kind: 'commit',
  el: el(),
  author: 'amy',
  time: null,
  title,
});
const forcePush = (): ForcePushEvent => ({
  kind: 'force_push',
  el: el(),
  author: 'amy',
  time: null,
});
const changes = (commits: CommitEvent[], forcePushes: ForcePushEvent[]): ChangesGroup => ({
  kind: 'changes',
  el: el(),
  commits,
  forcePushes,
  time: null,
});

describe('describeEntry', () => {
  // The row itself has to say what a review was, in words and in its dot's colour, because the
  // user shouldn't need to hover to tell an approval from a rejection.
  it('labels review verdicts with a matching colour', () => {
    const review = (state: ReviewState): Entry => ({
      kind: 'review',
      el: el(),
      author: 'amy',
      time: null,
      isBot: false,
      state,
      snippet: '',
    });
    const row = (state: ReviewState) => {
      const d = describeEntry(review(state), NOW);
      return [d.who, d.what, d.tone];
    };
    expect(row('approved')).toEqual(['amy', 'approved', 'success']);
    expect(row('changes_requested')).toEqual(['amy', 'requested changes', 'danger']);
    expect(row('commented')).toEqual(['amy', 'reviewed', 'accent']);
  });

  // Bots stay visible (the user asked for them) but are muted and tagged, so human conversation
  // stands out on bot-heavy PRs. The row drops the word "commented" (the comment dot and "bot" tag
  // already say it) so the bot's name has room; the hover still has the full sentence.
  it('flags and mutes bot comments', () => {
    const entry: Entry = {
      kind: 'comment',
      el: el(),
      author: 'github-actions',
      time: null,
      isBot: true,
      snippet: 'Thanks for the PR',
    };
    expect(describeEntry(entry, NOW)).toMatchObject({
      who: 'github-actions',
      what: '',
      isBot: true,
      tone: 'muted',
      summary: 'github-actions (bot) commented',
      detail: 'Thanks for the PR',
    });
  });

  // A changes row says what kind of pushes it holds and how many, in a few words. Force-pushes
  // get their own colour because they rewrite history.
  it('labels a changes row by what it contains', () => {
    const label = (c: number, f: number) => {
      const d = describeEntry(
        changes(
          Array.from({ length: c }, (_, i) => commit(`c${i}`)),
          Array.from({ length: f }, forcePush),
        ),
        NOW,
      );
      return [d.what, d.tone];
    };
    expect(label(1, 0)).toEqual(['1 commit', 'muted']);
    expect(label(3, 0)).toEqual(['3 commits', 'muted']);
    expect(label(0, 1)).toEqual(['Force-pushed', 'attention']);
    expect(label(0, 4)).toEqual(['Force-pushed 4×', 'attention']);
    expect(label(2, 1)).toEqual(['2 commits, force-pushed', 'attention']);
    expect(label(2, 3)).toEqual(['2 commits, force-pushed 3×', 'attention']);
  });

  // Hovering a changes row lists a few commit titles, without listing dozens.
  it('lists the first few commit titles as detail', () => {
    const group = changes(['a', 'b', 'c', 'd', 'e'].map(commit), []);
    expect(describeEntry(group, NOW).detail).toBe('a\nb\nc\n…and 2 more');
  });

  // Milestones read as the event itself ("Merged"). Who did it is in the hover text.
  it('labels milestones by the event, with the actor in the summary', () => {
    const merged: Entry = {
      kind: 'milestone',
      el: el(),
      author: 'amy',
      time: null,
      milestone: 'merged',
    };
    expect(describeEntry(merged, NOW)).toMatchObject({
      who: null,
      what: 'Merged',
      tone: 'done',
      summary: 'amy merged this PR',
    });
    expect(describeEntry({ ...merged, author: null }, NOW).summary).toBe('Merged');
  });

  // GitHub hides spam-flagged reviews, including who wrote them. The row mustn't say "null".
  it('labels a review with no visible author', () => {
    const hidden: Entry = {
      kind: 'review',
      el: el(),
      author: null,
      time: null,
      isBot: false,
      state: 'commented',
      snippet: '',
    };
    expect(describeEntry(hidden, NOW)).toMatchObject({ who: null, what: 'Hidden review' });
  });

  // The top row is the PR description, the natural "back to the top" target.
  it('labels the PR description', () => {
    const entry: Entry = {
      kind: 'description',
      el: el(),
      author: 'amy',
      time: null,
      snippet: 'Adds a thing',
    };
    expect(describeEntry(entry, NOW)).toMatchObject({
      who: null,
      what: 'PR description',
      summary: 'amy opened this PR',
      detail: 'Adds a thing',
    });
  });

  // Rows show a compact time ("3d"); the hover shows the long form ("3 days ago").
  it('gives a short time for the row and a long one for the hover', () => {
    const entry: Entry = { ...changes([], [forcePush()]), time: '2026-09-29T12:00:00Z' };
    expect(describeEntry(entry, NOW)).toMatchObject({ shortTime: '3d', time: '3 days ago' });
  });
});

describe('shortTime', () => {
  // Spot-check each unit boundary: rows have room for about three characters of time.
  it('picks the largest unit that fits', () => {
    expect(shortTime('2026-10-02T11:59:30Z', NOW)).toBe('now');
    expect(shortTime('2026-10-02T11:55:00Z', NOW)).toBe('5m');
    expect(shortTime('2026-10-02T09:00:00Z', NOW)).toBe('3h');
    expect(shortTime('2026-09-29T12:00:00Z', NOW)).toBe('3d');
    expect(shortTime('2026-09-11T12:00:00Z', NOW)).toBe('3w');
    expect(shortTime('2026-08-01T12:00:00Z', NOW)).toBe('2mo');
    expect(shortTime('2024-10-01T12:00:00Z', NOW)).toBe('2y');
  });

  // An unparseable timestamp shows nothing rather than "NaNd".
  it('returns null for a bad timestamp', () => {
    expect(shortTime('not a date', NOW)).toBeNull();
  });
});

describe('relativeTime', () => {
  // The hover text uses full words, so recent activity reads "5 minutes ago", not "0 days ago".
  it('picks the largest sensible unit', () => {
    expect(relativeTime('2026-10-02T11:59:30Z', NOW)).toBe('now');
    expect(relativeTime('2026-10-02T11:55:00Z', NOW)).toBe('5 minutes ago');
    expect(relativeTime('2026-10-02T09:00:00Z', NOW)).toBe('3 hours ago');
    expect(relativeTime('2026-10-01T12:00:00Z', NOW)).toBe('yesterday');
    expect(relativeTime('2026-08-01T12:00:00Z', NOW)).toBe('2 months ago');
    expect(relativeTime('2024-10-01T12:00:00Z', NOW)).toBe('2 years ago');
  });

  // Unparseable timestamps shouldn't render "NaN years ago".
  it('returns null for a bad timestamp', () => {
    expect(relativeTime('not a date', NOW)).toBeNull();
  });
});
