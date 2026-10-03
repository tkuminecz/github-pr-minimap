import { type Geometry, Minimap } from '../src/minimap';
import type { Entry, Span } from '../src/types';

/** In-memory stand-in for localStorage. */
function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

function comment(el: Element, author: string, isBot = false): Entry {
  return { kind: 'comment', el, author, time: null, isBot, snippet: `hi from ${author}` };
}

/**
 * jsdom has no layout engine, so tests describe the page with fake geometry. By default the
 * discussion starts at y=360 and there are three items at y=400, 2000 and 3000; `count` makes a
 * long PR instead, with an item every 100px from y=1000.
 */
function setup(
  opts: {
    count?: number;
    viewportHeight?: number;
    storage?: Pick<Storage, 'getItem' | 'setItem'>;
  } = {},
) {
  const discussion = document.createElement('div');
  document.body.append(discussion);
  const spans = new Map<Element, Span>([[discussion, { top: 360, bottom: 20_000 }]]);
  const tops = opts.count
    ? Array.from({ length: opts.count }, (_, i) => 1000 + i * 100)
    : [400, 2000, 3000];
  const els = tops.map((top) => {
    const el = discussion.appendChild(document.createElement('div'));
    spans.set(el, { top, bottom: top + 50 });
    return el;
  });

  let scrollTop = 0;
  const geometry: Geometry = {
    spanOf: (el) => spans.get(el) ?? null,
    scrollTop: () => scrollTop,
    viewportHeight: () => opts.viewportHeight ?? 800,
    scrollTo: vi.fn(),
  };
  const onHiddenClick = vi.fn();
  const minimap = new Minimap({
    geometry,
    onHiddenClick,
    storage: opts.storage ?? memoryStorage(),
    animate: false,
  });
  minimap.mount();
  const names = ['amy', 'bob', 'github-actions'];
  const entries = els.map((el, i) => comment(el, names[i] ?? `user${i}`, i === 2));
  const scrollPageTo = (top: number) => {
    scrollTop = top;
    minimap.updateViewport();
  };
  return { minimap, discussion, els, entries, geometry, onHiddenClick, spans, scrollPageTo };
}

const shown = <T extends HTMLElement>(minimap: Minimap, selector: string) =>
  [...minimap.shadowRoot.querySelectorAll<T>(selector)].filter((e) => !e.hidden);
const labelsOf = (minimap: Minimap) => shown(minimap, '.label');
const dotsOf = (minimap: Minimap) => shown(minimap, '.dot');
const connectorsOf = (minimap: Minimap) => [
  ...minimap.shadowRoot.querySelectorAll<SVGPathElement>('.connectors path'),
];
/** Start and end height of each connector: where it leaves the dot and where it meets the label. */
const connectorEnds = (minimap: Minimap) =>
  connectorsOf(minimap).map((path) => {
    const numbers = (path.getAttribute('d') ?? '').match(/-?[\d.]+/g)?.map(Number) ?? [];
    return { from: numbers[1] ?? Number.NaN, to: numbers.at(-1) ?? Number.NaN };
  });
/** Current magnification of a dot or label (1 when not magnified). */
const scaleOf = (el: HTMLElement | undefined) =>
  Number.parseFloat(el?.style.getPropertyValue('--m') || '1');
/**
 * Puts the pointer over the timeline, `y` px below the top of its line. jsdom has no layout, so the
 * timeline's on-screen box is stubbed: 248px wide at the left edge, 480px tall.
 */
function hoverAt(minimap: Minimap, y: number) {
  const timeline = minimap.shadowRoot.querySelector('.timeline') as HTMLElement;
  vi.spyOn(timeline, 'getBoundingClientRect').mockReturnValue(
    DOMRect.fromRect({ x: 0, y: 0, width: 248, height: 480 }),
  );
  window.dispatchEvent(new MouseEvent('pointermove', { clientX: 200, clientY: y }));
}
/** Distance from dot `i` to the next one. */
const gapAfter = (minimap: Minimap, i: number) =>
  Number.parseFloat(dotsOf(minimap)[i + 1]?.style.top ?? '') -
  Number.parseFloat(dotsOf(minimap)[i]?.style.top ?? '');
const labelledNames = (minimap: Minimap) =>
  labelsOf(minimap).map((l) => l.querySelector('.who')?.textContent);
const hostOf = () => document.querySelector('pr-minimap') as HTMLElement;
const timelineOf = (minimap: Minimap) =>
  minimap.shadowRoot.querySelector('.timeline') as HTMLElement;

afterEach(() => {
  for (const host of document.querySelectorAll('pr-minimap')) host.remove();
  document.body.innerHTML = '';
});

describe('Minimap', () => {
  // The panel lives in a shadow root so GitHub's CSS can't restyle it and ours can't leak.
  // Unmounting must remove it completely, because that's how it disappears on other tabs.
  it('mounts in a shadow root and unmounts cleanly', () => {
    const { minimap } = setup();
    expect(document.querySelectorAll('pr-minimap')).toHaveLength(1);
    expect(minimap.shadowRoot.mode).toBe('open');
    minimap.unmount();
    expect(document.querySelectorAll('pr-minimap')).toHaveLength(0);
  });

  // Page caches (Turbo snapshots) can leave a stale, empty host behind. Mounting replaces it
  // rather than stacking a second panel.
  it('replaces a stale host left over from a previous page', () => {
    document.documentElement.append(document.createElement('pr-minimap'));
    setup();
    expect(document.querySelectorAll('pr-minimap')).toHaveLength(1);
  });

  // Every entry gets a label saying what happened in words, so nothing needs a hover.
  it('labels each entry', () => {
    const { minimap, entries, discussion } = setup();
    minimap.setEntries(entries, discussion);
    expect(labelledNames(minimap)).toEqual(['amy', 'bob', 'github-actions']);
    expect(labelsOf(minimap).map((l) => l.querySelector('.what')?.textContent)).toEqual([
      'commented',
      'commented',
      '',
    ]);
  });

  // Bot labels are tagged, and their dots styled differently, so bots can be told apart at a
  // glance.
  it('marks bot entries', () => {
    const { minimap, entries, discussion } = setup();
    minimap.setEntries(entries, discussion);
    expect(labelsOf(minimap)[2]?.querySelector('.bot-tag')?.textContent).toBe('bot');
    expect(dotsOf(minimap).map((d) => d.hasAttribute('data-bot'))).toEqual([false, false, true]);
  });

  // Every entry also gets a dot on the timeline, shaped by its kind and coloured by its tone, so
  // the column of dots reads as the PR's history.
  it('puts a dot for each entry on the timeline', () => {
    const { minimap, discussion, els } = setup();
    const approved: Entry = {
      kind: 'review',
      el: els[1] as Element,
      author: 'bob',
      time: null,
      isBot: false,
      state: 'approved',
      snippet: '',
    };
    const merged: Entry = {
      kind: 'milestone',
      el: els[2] as Element,
      author: null,
      time: null,
      milestone: 'merged',
    };
    minimap.setEntries([comment(els[0] as Element, 'amy'), approved, merged], discussion);
    expect(dotsOf(minimap).map((d) => [d.dataset.kind, d.dataset.tone])).toEqual([
      ['comment', 'accent'],
      ['review', 'success'],
      ['milestone', 'done'],
    ]);
  });

  // A busy PR's line runs 60% of the window's height, with no margin: the first dot is its top and
  // the last dot its bottom.
  it("runs a busy PR's line 60% of the window tall, from the first dot to the last", () => {
    const { minimap, entries, discussion } = setup({ count: 20 });
    minimap.setEntries(entries, discussion);
    const line = minimap.shadowRoot.querySelector<HTMLElement>('.line');
    expect(line?.style.height).toBe('480px');
    expect(dotsOf(minimap)[0]?.style.top).toBe('0px');
    expect(dotsOf(minimap)[19]?.style.top).toBe('480px');
  });

  // The bug report: a PR with a handful of events spread them ~190px apart down the 60% line, which
  // looked empty and disconnected. Dots are never more than 32px apart, so a short PR gets a short
  // line.
  it('gives a quiet PR a short line, dots at most 32px apart', () => {
    const { minimap, entries, discussion } = setup();
    minimap.setEntries(entries, discussion);
    const line = minimap.shadowRoot.querySelector<HTMLElement>('.line');
    expect(line?.style.height).toBe('64px');
    expect(dotsOf(minimap).map((d) => d.style.top)).toEqual(['0px', '32px', '64px']);
  });

  // The label column reaches past both ends of the line, so each connector fans outward from its
  // dot to its label, like branches: the top one slopes up, the middle one is flat, the bottom one
  // slopes down.
  it('fans the connectors outward from the dots to the labels', () => {
    const { minimap, entries, discussion } = setup();
    minimap.setEntries(entries, discussion);
    expect(labelsOf(minimap).map((l) => l.style.top)).toEqual(['-24px', '32px', '88px']);
    const ends = connectorEnds(minimap);
    expect(ends.map(({ from }) => from)).toEqual([0, 32, 64]);
    expect(ends.map(({ to }) => to)).toEqual([-24, 32, 88]);
  });

  // Where the dots crowd together (a long PR), the labels are spread apart for reading and the
  // connectors fan out from the dots to them.
  it('fans the connectors out where dots crowd together', () => {
    const { minimap, entries, discussion } = setup({ count: 60, viewportHeight: 400 });
    minimap.setEntries(entries, discussion);
    const ends = connectorEnds(minimap);
    expect(ends.length).toBe(labelsOf(minimap).length);
    expect(ends.some(({ from, to }) => Math.abs(from - to) > 5)).toBe(true);
  });

  // Items that aren't rendered (collapsed or display:none) can't be scrolled to, so they get
  // neither dot nor label.
  it('leaves out items with no position', () => {
    const { minimap, entries, discussion, els, spans } = setup();
    spans.delete(els[1] as Element);
    minimap.setEntries(entries, discussion);
    expect(labelledNames(minimap)).toEqual(['amy', 'github-actions']);
    expect(dotsOf(minimap)).toHaveLength(2);
    expect(connectorsOf(minimap)).toHaveLength(2);
  });

  // Clicking a label or its dot scrolls to the item, leaving room for GitHub's sticky header.
  it('scrolls to the item when a label or dot is clicked', () => {
    const { minimap, entries, discussion, geometry } = setup();
    minimap.setEntries(entries, discussion);
    labelsOf(minimap)[1]?.click();
    expect(geometry.scrollTo).toHaveBeenLastCalledWith(2000 - 80);
    dotsOf(minimap)[2]?.click();
    expect(geometry.scrollTo).toHaveBeenLastCalledWith(3000 - 80);
  });

  // The hidden-items entry also hands itself to the loader callback, so clicking it loads the
  // items when auto-load is off.
  it('hands hidden-items clicks to the loader callback', () => {
    const { minimap, discussion, els, onHiddenClick } = setup();
    const hidden: Entry = {
      kind: 'hidden',
      el: els[0] as Element,
      author: null,
      time: null,
      count: 9,
    };
    minimap.setEntries([hidden], discussion);
    labelsOf(minimap)[0]?.click();
    expect(onHiddenClick).toHaveBeenCalledWith(hidden);
  });

  // The page updates often (live comments, timestamps). If the entries didn't change, labels and
  // dots must be the same DOM nodes, so a hovered or focused one isn't destroyed under the cursor.
  it('keeps nodes when the entries have not changed', () => {
    const { minimap, entries, discussion } = setup();
    minimap.setEntries(entries, discussion);
    const before = [...labelsOf(minimap), ...dotsOf(minimap)];
    minimap.setEntries(
      entries.map((e) => ({ ...e })),
      discussion,
    );
    const after = [...labelsOf(minimap), ...dotsOf(minimap)];
    expect(after.every((node, i) => node === before[i])).toBe(true);
  });

  // ...but a new comment arriving must show up.
  it('rebuilds when entries are added', () => {
    const { minimap, entries, discussion } = setup();
    minimap.setEntries(entries.slice(0, 2), discussion);
    minimap.setEntries(entries, discussion);
    expect(labelsOf(minimap)).toHaveLength(3);
  });

  // Whatever is on screen is highlighted (label and dot), which is how the panel shows where you
  // are. The viewport is 800px tall: at the top only the first item is visible, further down only
  // the second.
  it('highlights what is on screen', () => {
    const { minimap, entries, discussion, scrollPageTo } = setup();
    minimap.setEntries(entries, discussion);
    const onScreen = () => labelsOf(minimap).map((l) => l.classList.contains('on-screen'));
    expect(onScreen()).toEqual([true, false, false]);
    expect(dotsOf(minimap).map((d) => d.classList.contains('on-screen'))).toEqual([
      true,
      false,
      false,
    ]);
    scrollPageTo(1600);
    expect(onScreen()).toEqual([false, true, false]);
  });

  // On a long PR not every label fits. Every entry keeps its dot, and the labels show the section
  // you're reading, following the page as it scrolls.
  it('labels the section of a long PR that is on screen', () => {
    const { minimap, entries, discussion, scrollPageTo } = setup({
      count: 60,
      viewportHeight: 400,
    });
    minimap.setEntries(entries, discussion);
    expect(dotsOf(minimap)).toHaveLength(60);
    const labelled = () => labelsOf(minimap).map((l) => l.dataset.index);
    expect(labelled()).toContain('0');
    expect(labelled().length).toBeLessThan(60);

    scrollPageTo(1000 + 40 * 100);
    expect(labelled()).toContain('40');
    expect(labelled()).not.toContain('0');
  });

  // The bug report: moving the pointer near the line used to slide the labelled section around
  // under the cursor. Labels only follow the page's scroll position, never the pointer.
  it('keeps the labels still when the pointer moves along the line', () => {
    const { minimap, entries, discussion } = setup({ count: 60, viewportHeight: 400 });
    minimap.setEntries(entries, discussion);
    const before = labelsOf(minimap).map((l) => [l.dataset.index, l.style.top]);
    const dot = dotsOf(minimap)[50] as HTMLElement;
    const lineZone = minimap.shadowRoot.querySelector('.line-zone') as HTMLElement;
    lineZone.dispatchEvent(
      new MouseEvent('pointermove', { clientY: Number.parseFloat(dot.style.top) }),
    );
    expect(labelsOf(minimap).map((l) => [l.dataset.index, l.style.top])).toEqual(before);
  });

  // Like the macOS Dock, but subtle: with the pointer over the timeline, the dot under it grows
  // and its neighbours spread apart, and the nearest label grows a little. Which labels are shown
  // doesn't change, so nothing jumps.
  it('magnifies around the pointer like the macOS Dock', () => {
    const { minimap, entries, discussion } = setup({ count: 20 });
    minimap.setEntries(entries, discussion);
    const before = labelsOf(minimap).map((l) => l.dataset.index);
    const restingGap = gapAfter(minimap, 10);
    hoverAt(minimap, Number.parseFloat(dotsOf(minimap)[10]?.style.top ?? ''));
    expect(scaleOf(dotsOf(minimap)[10])).toBeGreaterThan(1.3);
    expect(scaleOf(dotsOf(minimap)[10])).toBeLessThan(1.6);
    expect(gapAfter(minimap, 10)).toBeGreaterThan(restingGap);
    expect(Math.max(...labelsOf(minimap).map(scaleOf))).toBeGreaterThan(1.05);
    expect(labelsOf(minimap).map((l) => l.dataset.index)).toEqual(before);
  });

  // The bug report: magnifying pushed the first dot up past the eye, tangling the eye into the
  // timeline. Magnifying only shares out space along the line; its ends never move.
  it('never moves the ends of the line while magnifying', () => {
    const { minimap, entries, discussion } = setup({ count: 20 });
    minimap.setEntries(entries, discussion);
    const line = minimap.shadowRoot.querySelector<HTMLElement>('.line');
    for (const y of [-40, 0, 60, 240, 420, 480, 520]) {
      hoverAt(minimap, y);
      const dots = dotsOf(minimap);
      expect(dots[0]?.style.top, `pointer at ${y}`).toBe('0px');
      expect(Number.parseFloat(dots[19]?.style.top ?? '')).toBeCloseTo(480);
      expect(Number.parseFloat(line?.style.height ?? '')).toBeCloseTo(480);
    }
  });

  // Moving the pointer away puts everything back exactly where it was.
  it('settles back when the pointer leaves', () => {
    const { minimap, entries, discussion } = setup();
    minimap.setEntries(entries, discussion);
    const at = () => dotsOf(minimap).map((d) => [d.style.top, scaleOf(d)]);
    const resting = at();
    hoverAt(minimap, 240);
    expect(at()).not.toEqual(resting);
    window.dispatchEvent(new MouseEvent('pointermove', { clientX: 2000, clientY: 240 }));
    expect(at()).toEqual(resting);
  });

  // The timeline sits at the window's right edge, so the pointer often leaves the window straight
  // from it. No more moves arrive after that, so leaving has to let go of the magnification, or it
  // would stay stuck on until the pointer came back.
  it('lets go when the pointer leaves the window', () => {
    const { minimap, entries, discussion } = setup();
    minimap.setEntries(entries, discussion);
    hoverAt(minimap, 240);
    expect(Math.max(...dotsOf(minimap).map(scaleOf))).toBeGreaterThan(1);
    document.documentElement.dispatchEvent(
      new MouseEvent('pointerout', { bubbles: true, relatedTarget: null }),
    );
    expect(dotsOf(minimap).map(scaleOf)).toEqual([1, 1, 1]);
  });

  // Each dot on the line is its event's icon, so a comment, an approval and a merge can be told
  // apart without reading the labels.
  it('draws each event on the line as its icon', () => {
    const { minimap, entries, discussion } = setup();
    minimap.setEntries(entries, discussion);
    expect(dotsOf(minimap).map((d) => d.dataset.icon)).toEqual([
      'message-square',
      'message-square',
      'bot-message-square',
    ]);
    expect(dotsOf(minimap)[0]?.querySelector('svg.glyph path')).not.toBeNull();
    expect(timelineOf(minimap).classList.contains('compact')).toBe(false);
  });

  // Where events crowd closer together than an icon is tall, the icons would pile up into a blur,
  // so the line falls back to small dots in each event's colour.
  it('falls back to plain dots where icons would crowd', () => {
    const { minimap, entries, discussion } = setup({ count: 60, viewportHeight: 400 });
    minimap.setEntries(entries, discussion);
    expect(timelineOf(minimap).classList.contains('compact')).toBe(true);
  });

  // A day or more with nothing happening breaks the line: a gap in it between two slashes, with how
  // long it lasted written in the gap. The break sits halfway between its two events, which get
  // 16px of extra room for it.
  it('marks quiet stretches on the line', () => {
    const { minimap, els, discussion } = setup();
    const at = (el: Element | undefined, time: string): Entry => ({
      ...comment(el as Element, 'amy'),
      time,
    });
    minimap.setEntries(
      [
        at(els[0], '2026-09-01T10:00:00Z'),
        at(els[1], '2026-09-01T12:00:00Z'),
        at(els[2], '2026-09-16T12:00:00Z'),
      ],
      discussion,
    );
    const breaks = [...minimap.shadowRoot.querySelectorAll<HTMLElement>('.break')];
    expect(breaks.map((b) => b.textContent)).toEqual(['2w']);
    expect(breaks[0]?.querySelectorAll('.slash')).toHaveLength(2);
    expect(timelineOf(minimap).classList.contains('tight-breaks')).toBe(false);
    const [a = 0, b = 0, c = 0] = dotsOf(minimap).map((d) => Number.parseFloat(d.style.top));
    expect(Number.parseFloat(breaks[0]?.style.top ?? '')).toBeCloseTo((b + c) / 2);
    expect(c - b).toBeCloseTo(b - a + 16);
  });

  // On a crowded line the gap is too small to write in, so the time sits beside the line instead.
  it('writes the time beside the line where the gap is too small for it', () => {
    const { minimap, els, discussion } = setup({ count: 60, viewportHeight: 400 });
    const start = Date.parse('2026-09-01T10:00:00Z');
    const hourly = els.map((el, i): Entry => {
      const time = start + i * 3600_000 + (i >= 30 ? 3 * 86400_000 : 0);
      return { ...comment(el, `user${i}`), time: new Date(time).toISOString() };
    });
    minimap.setEntries(hourly, discussion);
    const breaks = [...minimap.shadowRoot.querySelectorAll<HTMLElement>('.break')];
    expect(breaks.map((b) => b.textContent)).toEqual(['3d']);
    expect(timelineOf(minimap).classList.contains('tight-breaks')).toBe(true);
  });

  // With the timeline hidden by the eye, hovering where it was does nothing.
  it('does not magnify while hidden', () => {
    const { minimap, entries, discussion } = setup();
    minimap.setEntries(entries, discussion);
    minimap.shadowRoot.querySelector<HTMLButtonElement>('.eye')?.click();
    hoverAt(minimap, 240);
    expect(dotsOf(minimap).map(scaleOf)).toEqual([1, 1, 1]);
  });

  // At the top of the page, the timeline's top label starts level with the conversation (at 360px),
  // so neither it nor the line covers the repo header or the tabs row. The top label's centre sits
  // 24px above the line and it's 18px tall, so the line starts 33px lower. Once scrolled, it stays
  // below GitHub's sticky header, with room above the line for the eye and for labels reaching
  // past its top.
  it('starts level with the conversation and sticks below the header', () => {
    const { minimap, entries, discussion, scrollPageTo } = setup({ viewportHeight: 1200 });
    minimap.setEntries(entries, discussion);
    expect(hostOf().style.top).toBe('393px');
    scrollPageTo(1000);
    expect(hostOf().style.top).toBe('136px');
  });

  // On a short window the line would run off the bottom if it started level with the conversation,
  // so it starts higher instead: 800px window, 480px line, and 76px at the bottom so labels that
  // reach past the end of the line stay on screen.
  it('never runs off the bottom of the window', () => {
    const { minimap, entries, discussion } = setup({ count: 20, viewportHeight: 800 });
    minimap.setEntries(entries, discussion);
    expect(hostOf().style.top).toBe('244px');
  });

  // The eye shows or hides the whole timeline, leaving just the eye. Hiding fades it out rather
  // than removing it instantly: it becomes transparent and inert (no clicks, no keyboard focus)
  // instead of display:none, which can't be animated. The choice is remembered for the next PR.
  it('fades the timeline out and in with the eye, and remembers it', () => {
    const storage = memoryStorage();
    const { minimap, entries, discussion } = setup({ storage });
    minimap.setEntries(entries, discussion);
    const eye = minimap.shadowRoot.querySelector<HTMLButtonElement>('.eye');
    const timeline = minimap.shadowRoot.querySelector<HTMLElement>('.timeline');
    const state = () => ({
      pressed: eye?.getAttribute('aria-pressed'),
      faded: timeline?.classList.contains('faded'),
      inert: timeline?.hasAttribute('inert'),
      removed: timeline?.hidden,
    });
    expect(state()).toEqual({ pressed: 'true', faded: false, inert: false, removed: false });
    eye?.click();
    expect(state()).toEqual({ pressed: 'false', faded: true, inert: true, removed: false });
    eye?.click();
    expect(state()).toEqual({ pressed: 'true', faded: false, inert: false, removed: false });

    eye?.click();
    minimap.unmount();
    const again = setup({ storage });
    const timelineAgain = again.minimap.shadowRoot.querySelector<HTMLElement>('.timeline');
    expect(timelineAgain?.classList.contains('faded')).toBe(true);
  });

  // Running the pointer along the line passes over dots. A dot lights up its own label and
  // connector, so you can see which label is whose, but doesn't pop up a tooltip, which would
  // cover the very labels you're browsing.
  it('lights up the matching label when hovering a dot, without a tooltip', () => {
    const { minimap, entries, discussion } = setup();
    minimap.setEntries(entries, discussion);
    dotsOf(minimap)[1]?.dispatchEvent(new Event('pointerenter'));
    expect(labelsOf(minimap).map((l) => l.classList.contains('hot'))).toEqual([false, true, false]);
    expect(connectorsOf(minimap).map((p) => p.classList.contains('hot'))).toEqual([
      false,
      true,
      false,
    ]);
    expect(minimap.shadowRoot.querySelector<HTMLElement>('.tooltip')?.hidden).toBe(true);
  });

  // Hover is optional, but still useful: it shows the full sentence, the long time and the
  // comment snippet.
  it('shows extra detail on hover', () => {
    const { minimap, entries, discussion } = setup();
    minimap.setEntries(entries, discussion);
    const label = labelsOf(minimap)[2];
    label?.dispatchEvent(new Event('pointerenter'));
    const tip = minimap.shadowRoot.querySelector<HTMLElement>('.tooltip');
    expect(tip?.hidden).toBe(false);
    expect(tip?.textContent).toContain('github-actions (bot) commented');
    expect(tip?.textContent).toContain('hi from github-actions');
    label?.dispatchEvent(new Event('pointerleave'));
    expect(tip?.hidden).toBe(true);
  });
});
