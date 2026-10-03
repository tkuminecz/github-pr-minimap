import { quietStretches } from '../src/quiet';
import type { Entry } from '../src/types';

const at = (time: string | null): Entry => ({
  kind: 'comment',
  el: document.createElement('div'),
  author: 'amy',
  time,
  isBot: false,
  snippet: '',
});
const pushes = (firstTime: string, time: string): Entry => ({
  kind: 'changes',
  el: document.createElement('div'),
  commits: [],
  forcePushes: [],
  time,
  firstTime,
});

describe('quietStretches', () => {
  // Activity within a day of the last isn't a pause worth marking.
  it('ignores gaps shorter than a day', () => {
    expect(quietStretches([at('2026-09-01T10:00:00Z'), at('2026-09-02T09:00:00Z')])).toEqual([]);
  });

  // A day or more with nothing happening is marked, labelled with how long it lasted.
  it('marks a day or more of quiet', () => {
    const entries = [
      at('2026-09-01T10:00:00Z'),
      at('2026-09-04T10:00:00Z'),
      at('2026-09-05T09:00:00Z'),
      at('2026-09-20T10:00:00Z'),
    ];
    expect(quietStretches(entries)).toEqual([
      { after: 0, label: '3d' },
      { after: 2, label: '2w' },
    ]);
  });

  // A row of pushes can span days on its own. The quiet before it ends at its first push and the
  // quiet after it starts at its last, so pushes over a week with replies either side of them
  // within hours are not a quiet stretch.
  it('measures to the first push of a row of changes and from its last', () => {
    const entries = [
      at('2026-09-01T10:00:00Z'),
      pushes('2026-09-01T12:00:00Z', '2026-09-09T12:00:00Z'),
      at('2026-09-10T10:00:00Z'),
    ];
    expect(quietStretches(entries)).toEqual([]);
  });

  // Some rows have no date on the page: the commits that came with the PR when it was opened, and
  // comments or reviews hidden as spam. The quiet is measured across them, from the last dated row
  // to the next, and the break goes just before the next dated row. That's right for the commonest
  // case, commits that came with the PR, which were pushed when it was opened.
  it('measures across undated rows, breaking just before the next dated one', () => {
    const openedWithCommits = [
      at('2026-09-01T10:00:00Z'),
      at(null),
      at(null),
      at('2026-09-20T10:00:00Z'),
      at('2026-09-20T11:00:00Z'),
    ];
    expect(quietStretches(openedWithCommits)).toEqual([{ after: 2, label: '2w' }]);
  });

  // Undated rows at the start have nothing to measure from.
  it('draws no break before the first dated row', () => {
    expect(quietStretches([at(null), at('2026-09-20T10:00:00Z')])).toEqual([]);
  });

  // Page order can disagree with the timestamps. Time running backwards is never a quiet stretch.
  it('ignores times that run backwards', () => {
    expect(quietStretches([at('2026-09-20T10:00:00Z'), at('2026-09-01T10:00:00Z')])).toEqual([]);
  });
});
