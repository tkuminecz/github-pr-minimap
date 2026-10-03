import { shortDuration } from './describe';
import type { Entry } from './types';

const DAY = 24 * 3600 * 1000;

/** A day or more with no activity, between two neighbouring entries. */
export interface QuietStretch {
  /** Index of the entry the stretch follows. */
  after: number;
  /** How long it lasted: "3d", "2w". */
  label: string;
}

/**
 * Finds the quiet stretches between entries. Undated entries (commits that came with the PR when it
 * was opened, comments hidden as spam) are measured across, from the last dated entry to the next,
 * with the break just before the next dated one.
 */
export function quietStretches(entries: Entry[]): QuietStretch[] {
  const stretches: QuietStretch[] = [];
  let lastEnd = Number.NaN;
  entries.forEach((entry, i) => {
    const start = Date.parse((entry.kind === 'changes' ? entry.firstTime : entry.time) ?? '');
    const quiet = start - lastEnd;
    // NaN (an unknown time on either side) fails this too.
    if (quiet >= DAY) {
      stretches.push({ after: i - 1, label: shortDuration(quiet / 1000) });
    }
    const end = Date.parse(entry.time ?? '');
    if (!Number.isNaN(end)) lastEnd = end;
  });
  return stretches;
}
