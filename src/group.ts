import type { ChangesGroup, CommitEvent, Entry, ForcePushEvent, TimelineEvent } from './types';

/**
 * Collapses each run of back-to-back pushes (commits and force-pushes) into one ChangesGroup.
 * Every other event passes through by reference and ends the run.
 */
export function groupEntries(events: TimelineEvent[]): Entry[] {
  const out: Entry[] = [];
  let run: (CommitEvent | ForcePushEvent)[] = [];

  const flush = () => {
    const first = run[0];
    if (first) out.push(changesGroup(first.el, run));
    run = [];
  };

  for (const event of events) {
    if (event.kind === 'commit' || event.kind === 'force_push') {
      run.push(event);
    } else {
      flush();
      out.push(event);
    }
  }
  flush();
  return out;
}

function changesGroup(el: Element, run: (CommitEvent | ForcePushEvent)[]): ChangesGroup {
  const commits = run.filter((e): e is CommitEvent => e.kind === 'commit');
  const forcePushes = run.filter((e): e is ForcePushEvent => e.kind === 'force_push');
  const times = run
    .flatMap((e) => (e.time ? [e.time] : []))
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  return {
    kind: 'changes',
    el,
    commits,
    forcePushes,
    time: times.at(-1) ?? null,
    firstTime: times[0] ?? null,
  };
}
