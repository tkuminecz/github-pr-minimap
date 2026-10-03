export interface FanOptions {
  /** Closest two labels may get and still be readable. */
  minLabelPitch: number;
  /** The label column always reaches at least this far past each end of the line... */
  minOverhang: number;
  /** ...and at most this far. Beyond that, only a section of a long PR is labelled. */
  maxOverhang: number;
  /** Extra room on the line at each quiet-stretch break, for its mark. */
  breakRoom: number;
}

/** The most of the line that breaks may take between them, so a crowded line keeps room for dots. */
const MAX_BREAK_SHARE = 0.25;

export interface FanLayout {
  /** Centre of every entry's dot, in px from the top of the line. */
  dotYs: number[];
  /** The entries that get a label (a section around the focus when not all fit), and where. */
  labels: { index: number; y: number }[];
}

/**
 * Lays out the timeline. Every entry gets a dot, evenly spaced from the top of the line (first
 * entry) to the bottom (last entry), with a little extra room after each entry in `breaks` (where
 * a quiet stretch follows it). Labels form one evenly spaced column beside the line that
 * always reaches past both ends of it, so the connectors fan outward from the dots. A really long
 * PR doesn't fit even reaching `maxOverhang` past the ends; then only a section around the focus
 * is labelled.
 */
export function fanLayout(
  count: number,
  focus: number,
  height: number,
  { minLabelPitch, minOverhang, maxOverhang, breakRoom }: FanOptions,
  breaks: readonly number[] = [],
): FanLayout {
  if (count <= 0) return { dotYs: [], labels: [] };
  if (count === 1) return { dotYs: [0], labels: [{ index: 0, y: 0 }] };

  const gaps = count - 1;
  const after = new Set(breaks.filter((i) => i >= 0 && i < gaps));
  const extra = after.size ? Math.min(breakRoom, (height * MAX_BREAK_SHARE) / after.size) : 0;
  const pitch = (height - after.size * extra) / gaps;
  const dotYs = [0];
  for (let i = 1; i < count; i++) {
    dotYs.push((dotYs[i - 1] ?? 0) + pitch + (after.has(i - 1) ? extra : 0));
  }

  const room = height + 2 * maxOverhang;

  const span = Math.max(gaps * minLabelPitch, height + 2 * minOverhang);
  if (span <= room) {
    return { dotYs, labels: column(0, count, (height - span) / 2, span / gaps) };
  }

  const labelled = Math.floor(room / minLabelPitch) + 1;
  const clampedFocus = Math.min(Math.max(focus, 0), count - 1);
  const start = Math.min(Math.max(clampedFocus - Math.floor(labelled / 2), 0), count - labelled);
  const top = -maxOverhang + (room - (labelled - 1) * minLabelPitch) / 2;
  return { dotYs, labels: column(start, labelled, top, minLabelPitch) };
}

/** `size` labels for entries from `start`, evenly spaced from `top`. */
function column(start: number, size: number, top: number, pitch: number) {
  return Array.from({ length: size }, (_, j) => ({ index: start + j, y: top + j * pitch }));
}
