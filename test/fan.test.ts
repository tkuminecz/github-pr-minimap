import { fanLayout } from '../src/fan';

const OPTS = { minLabelPitch: 18, minOverhang: 24, maxOverhang: 60, breakRoom: 10 };
// Rounded to 0.01px; `+ 0` turns -0 into 0 so positions compare equal.
const rounded = (ys: number[]) => ys.map((y) => Math.round(y * 100) / 100 + 0);
const labelYs = (layout: ReturnType<typeof fanLayout>) => rounded(layout.labels.map((l) => l.y));

describe('fanLayout', () => {
  // No activity, nothing to draw.
  it('is empty for no entries', () => {
    expect(fanLayout(0, 0, 500, OPTS)).toEqual({ dotYs: [], labels: [] });
  });

  // The line has no margin: the first dot is its top and the last dot its bottom, with the rest
  // evenly spaced between.
  it('spreads the dots evenly from the top of the line to the bottom', () => {
    expect(fanLayout(5, 0, 400, OPTS).dotYs).toEqual([0, 100, 200, 300, 400]);
  });

  // A quiet stretch between two events gets a little extra room on the line (10px here) for its
  // break mark. The other events stay evenly spaced and the line keeps its length.
  it('adds room for quiet-stretch breaks, keeping the line its length', () => {
    expect(rounded(fanLayout(5, 0, 400, OPTS, [1]).dotYs)).toEqual([0, 97.5, 205, 302.5, 400]);
  });

  // On a crowded line the breaks share at most a quarter of its length, so the events keep most of
  // it: one break on a 20px line gets 5px, not 10px.
  it('gives breaks at most a quarter of a crowded line', () => {
    expect(rounded(fanLayout(3, 0, 20, OPTS, [0]).dotYs)).toEqual([0, 12.5, 20]);
  });

  // A lone event sits at the top of the line, its label level with it.
  it('puts a single dot at the top', () => {
    expect(fanLayout(1, 0, 400, OPTS)).toEqual({ dotYs: [0], labels: [{ index: 0, y: 0 }] });
  });

  // The label column always reaches past both ends of the line (24px here), so the connectors fan
  // outward from the dots: steepest at the ends, flat in the middle. It expands, never contracts.
  it('spreads the labels past both ends of the line', () => {
    expect(labelYs(fanLayout(5, 0, 400, OPTS))).toEqual([-24, 88, 200, 312, 424]);
  });

  // When the labels need more room than that, the column grows further past the ends, up to 60px.
  // 30 labels at 18px need 522px, so on a 460px line they reach 31px past each end.
  it('reaches further past the ends when the labels need the room', () => {
    const ys = labelYs(fanLayout(30, 0, 460, OPTS));
    expect(ys).toHaveLength(30);
    expect(ys[0]).toBe(-31);
    expect(ys.at(-1)).toBe(491);
  });

  // The bug report: a PR of about 35 events on a tall window left its first two dots without
  // labels. That many events must all be labelled.
  it('labels every event of a mid-sized PR', () => {
    const layout = fanLayout(35, 34, 700, OPTS);
    expect(layout.labels.map((l) => l.index)).toEqual(Array.from({ length: 35 }, (_, i) => i));
  });

  // The other half of the bug report: connectors sometimes came out nearly parallel, or angled
  // inward. Whatever the number of events, the outermost connectors must clearly angle outward (the
  // first label above its dot, the last below), and labels are never closer than 18px.
  it('always fans the outermost connectors outward, for any number of events', () => {
    for (let count = 2; count <= 120; count++) {
      const layout = fanLayout(count, count - 1, 600, OPTS);
      const first = layout.labels[0];
      const last = layout.labels.at(-1);
      const dotOf = (l: { index: number } | undefined) => layout.dotYs[l?.index ?? 0] ?? 0;
      expect(dotOf(first) - (first?.y ?? 0), `${count} events, first`).toBeGreaterThanOrEqual(10);
      expect((last?.y ?? 0) - dotOf(last), `${count} events, last`).toBeGreaterThanOrEqual(10);
      layout.labels.slice(1).forEach((l, j) => {
        expect(l.y - (layout.labels[j]?.y ?? 0), `${count} events`).toBeGreaterThanOrEqual(
          18 - 1e-9,
        );
      });
    }
  });

  // Only a really long PR has more events than labels can fit, even reaching 60px past each end.
  // Then the labels cover a section around the entry you're reading (the focus).
  it('labels a section around the focus on a really long PR', () => {
    const layout = fanLayout(100, 50, 200, OPTS);
    const indexes = layout.labels.map((l) => l.index);
    expect(indexes).toHaveLength(18);
    expect(indexes).toEqual(Array.from({ length: 18 }, (_, j) => 41 + j));
    const ys = labelYs(layout);
    expect(ys[0]).toBeGreaterThanOrEqual(-60);
    expect(ys.at(-1)).toBeLessThanOrEqual(260);
  });

  // At either end of a long PR, the section stops at the first/last entry.
  it('clamps the labelled section at the ends', () => {
    expect(fanLayout(100, 2, 200, OPTS).labels[0]?.index).toBe(0);
    expect(fanLayout(100, 98, 200, OPTS).labels.at(-1)?.index).toBe(99);
  });
});
