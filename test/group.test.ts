import { groupEntries } from '../src/group';
import type {
  CommentEvent,
  CommitEvent,
  ForcePushEvent,
  HiddenEvent,
  MilestoneEvent,
} from '../src/types';

function el(): Element {
  return document.createElement('div');
}

function commit(title: string): CommitEvent {
  return { kind: 'commit', el: el(), author: 'a', time: null, title };
}

function forcePush(time: string | null = null): ForcePushEvent {
  return { kind: 'force_push', el: el(), author: 'a', time };
}

function comment(snippet: string): CommentEvent {
  return { kind: 'comment', el: el(), author: 'a', time: null, isBot: false, snippet };
}

describe('groupEntries', () => {
  // An empty timeline stays empty, so callers can render zero rows without a special case.
  it('returns [] for empty input', () => {
    expect(groupEntries([])).toEqual([]);
  });

  // A lone commit still becomes a changes row, so the renderer only ever deals with groups.
  it('wraps a single commit in a changes group', () => {
    const c = commit('one');
    expect(groupEntries([c])).toEqual([
      { kind: 'changes', el: c.el, commits: [c], forcePushes: [], time: null },
    ]);
  });

  // The user doesn't need each push. Commits and force-pushes in a row (no comment in between)
  // are one row, which points at the first push and is timed by the latest force-push.
  it('collapses commits and force-pushes in a row into one group', () => {
    const c1 = commit('a');
    const fp1 = forcePush('2026-09-01T10:00:00Z');
    const c2 = commit('b');
    const fp2 = forcePush('2026-09-02T10:00:00Z');
    expect(groupEntries([c1, fp1, c2, fp2])).toEqual([
      {
        kind: 'changes',
        el: c1.el,
        commits: [c1, c2],
        forcePushes: [fp1, fp2],
        time: '2026-09-02T10:00:00Z',
      },
    ]);
  });

  // A comment between pushes splits them, so you can see it landed between two rounds of changes.
  it('splits pushes around a comment', () => {
    const fp = forcePush();
    const cm = comment('please fix');
    const c = commit('fix');
    const out = groupEntries([fp, cm, c]);
    expect(out.map((e) => e.kind)).toEqual(['changes', 'comment', 'changes']);
    expect(out[1]).toBe(cm);
  });

  // Milestones and the hidden-items placeholder are rows of their own, so they split pushes too.
  it('splits pushes around milestones and hidden items', () => {
    const merged: MilestoneEvent = {
      kind: 'milestone',
      el: el(),
      author: null,
      time: null,
      milestone: 'merged',
    };
    const hidden: HiddenEvent = { kind: 'hidden', el: el(), author: null, time: null, count: 3 };
    const out = groupEntries([commit('a'), hidden, commit('b'), merged, forcePush()]);
    expect(out.map((e) => e.kind)).toEqual([
      'changes',
      'hidden',
      'changes',
      'milestone',
      'changes',
    ]);
  });

  // Rows that aren't pushes pass through as the same object, so later code can compare with ===.
  it('passes other events through by reference', () => {
    const cm = comment('hi');
    expect(groupEntries([cm])[0]).toBe(cm);
  });
});
