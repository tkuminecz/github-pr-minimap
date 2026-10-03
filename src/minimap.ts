import { describeEntry } from './describe';
import { type FanLayout, fanLayout } from './fan';
import { MONO, SANS } from './fonts';
import { ICONS, type IconName } from './icons';
import { magnify } from './magnify';
import { NODE_ICONS, type NodeIcon } from './node-icons';
import { type QuietStretch, quietStretches } from './quiet';
import type { Entry, HiddenEvent, Span } from './types';

/** Page measurements, behind an interface so tests can fake them (jsdom has no layout). */
export interface Geometry {
  /** Element's span in page coordinates, or null when it isn't rendered. */
  spanOf(el: Element): Span | null;
  scrollTop(): number;
  viewportHeight(): number;
  scrollTo(top: number): void;
}

export const browserGeometry: Geometry = {
  spanOf(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;
    return { top: rect.top + window.scrollY, bottom: rect.bottom + window.scrollY };
  },
  scrollTop: () => window.scrollY,
  viewportHeight: () => window.innerHeight,
  scrollTo: (top) => window.scrollTo({ top, behavior: 'smooth' }),
};

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

export interface MinimapOptions {
  geometry?: Geometry;
  onHiddenClick?: (entry: HiddenEvent) => void;
  /** Where the shown/hidden choice is remembered. Defaults to localStorage. */
  storage?: KeyValueStorage | null;
  /** Ease the hover magnification in and out. Off in tests, so effects apply immediately. */
  animate?: boolean;
}

const HOST_TAG = 'pr-minimap';
const HIDDEN_KEY = 'pr-minimap:hidden';
/** GitHub's sticky PR header once scrolled, plus room for labels reaching past the line's top. */
const MIN_TOP = 136;
/** Room below the line: a gap, plus labels reaching past its end. */
const BOTTOM_GAP = 76;
/** The most of the window's height the line runs, for a busy PR. */
const LINE_FRACTION = 0.6;
/** The furthest apart two dots get, so a PR with few events gets a short line, not sparse dots. */
const MAX_DOT_PITCH = 32;
/** Room left above a scrolled-to item for GitHub's sticky header. */
const SCROLL_OFFSET = 80;
/** Extra room on the line where a quiet stretch breaks it, for the break's mark. */
const BREAK_ROOM = 16;
/** The gap a break leaves in the line: at most this tall, and tall enough to write in from... */
const BREAK_GAP_MAX = 20;
const BREAK_LABEL_MIN_GAP = 13;
/** ...keeping this much clear between the break's slashes and the events either side. */
const BREAK_CLEARANCE = 4;
/** Size of an event on a line too crowded for icons. */
const COMPACT_DOT = 8;
/** Label column: at least 18px between labels, reaching 24-60px past each end of the line. */
const FAN = { minLabelPitch: 18, minOverhang: 24, maxOverhang: 60, breakRoom: BREAK_ROOM };
/** Events are drawn as icons this size, unless they're closer together than `ICON_MIN_PITCH`. */
const ICON_SIZE = 13;
const ICON_MIN_PITCH = 16;
/** Hover magnification, like the macOS Dock but subtle: dots grow by half, labels a touch. */
const DOCK_DOTS = { radius: 80, maxScale: 1.45 };
const DOCK_LABELS = { radius: 80, maxScale: 1.1 };
/** How quickly the magnification follows the pointer in and out (time constant, ms). */
const DOCK_EASE_MS = 80;
/** How close to the timeline (beyond its labels) the pointer counts as over it. */
const HOVER_SLOP = 12;
/** Horizontal room the connectors fan out in, between label ends and the timeline line. */
const CONNECTOR_WIDTH = 30;
/** The timeline line's centre, from the panel's right edge. */
const LINE_RIGHT = 15;
/** The strip around the line reaches this far past its ends, so end dots are easy to click. */
const LINE_ZONE_PAD = 6;

interface Item {
  entry: Entry;
  label: HTMLButtonElement;
  dot: HTMLButtonElement;
  span: Span | null;
  /** The connector to this item's label, while it has one. */
  path: SVGPathElement | null;
  /** Where its label was last painted (y and magnification), for the tooltip to follow. */
  labelY: number;
  labelScale: number;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Half a label's height: labels are centred on their position. */
const LABEL_HALF_HEIGHT = 9;
/** The label column's right edge, from the panel's right edge. */
const LABEL_RIGHT = LINE_RIGHT + CONNECTOR_WIDTH + 2;

export class Minimap {
  readonly shadowRoot: ShadowRoot;
  private readonly host: HTMLElement;
  private readonly timeline: HTMLElement;
  private readonly lineZone: HTMLElement;
  private readonly line: HTMLElement;
  private readonly connectors: SVGSVGElement;
  private readonly eye: HTMLButtonElement;
  private readonly tooltip: HTMLElement;
  private readonly geometry: Geometry;
  private readonly storage: KeyValueStorage | null;

  private items: Item[] = [];
  /** Items that have a position on the page, in page order. The fan lays these out. */
  private placed: Item[] = [];
  /** Quiet stretches between placed items, and the marks that break the line for them. */
  private quiet: QuietStretch[] = [];
  private readonly breaks: HTMLElement[] = [];
  private rangeEl: Element | null = null;
  private lastLayoutKey = '';
  private visible = true;
  private layout: FanLayout | null = null;
  /** Pointer height relative to the top of the line, kept while the magnification eases out. */
  private pointer = 0;
  /** How magnified the timeline is (0..1), easing toward `targetStrength`. */
  private strength = 0;
  private targetStrength = 0;
  private frame = 0;
  private lastFrameTime = 0;
  /** Latest pointer position on screen, handled at most once per animation frame. */
  private pointerClient: { x: number; y: number } | null = null;
  /**
   * The timeline's box on screen. Reading it forces a layout, so it's read once and kept until
   * the timeline moves (scroll, resize), not on every pointer move.
   */
  private box: DOMRect | null = null;
  private hostTop = Number.NaN;
  /** The label whose tooltip is showing, and its unmagnified width. */
  private tooltipItem: Item | null = null;
  private tooltipWidth = 0;
  /** Connector paths, reused from one layout to the next. */
  private readonly paths: SVGPathElement[] = [];
  private readonly onPointerMove = (e: MouseEvent) => this.trackPointer(e);
  /** Leaving the window: no target to go to. */
  private readonly onPointerOut = (e: MouseEvent) => {
    if (e.relatedTarget) return;
    this.pointerClient = null;
    this.follow();
  };

  constructor(private readonly options: MinimapOptions = {}) {
    this.geometry = options.geometry ?? browserGeometry;
    this.storage = options.storage === undefined ? defaultStorage() : options.storage;

    this.host = document.createElement(HOST_TAG);
    this.shadowRoot = this.host.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `<style>${STYLES}</style>
      <button type="button" class="eye"></button>
      <nav class="timeline" aria-label="Pull request activity">
        <svg class="connectors" aria-hidden="true"></svg>
        <div class="labels"></div>
        <div class="line-zone"><div class="line"></div></div>
      </nav>
      <div class="tooltip" role="tooltip" hidden></div>`;
    const $ = <T extends Element>(selector: string) => this.shadowRoot.querySelector(selector) as T;
    this.timeline = $('.timeline');
    this.lineZone = $('.line-zone');
    this.line = $('.line');
    this.connectors = $('.connectors');
    this.eye = $('.eye');
    this.tooltip = $('.tooltip');

    this.eye.addEventListener('click', () => this.setVisible(!this.visible, true));
    this.setVisible(!this.readHidden(), false);
  }

  get isMounted(): boolean {
    return this.host.isConnected;
  }

  /**
   * Mounts on <html> rather than <body>: GitHub's page navigation swaps <body> out, which would
   * take the panel with it.
   */
  mount(): void {
    for (const stale of document.querySelectorAll(HOST_TAG)) {
      if (stale !== this.host) stale.remove();
    }
    document.documentElement.append(this.host);
    // Watched on the window, not the timeline, so the gaps between labels still count as hovering
    // without an invisible box blocking clicks on the page underneath.
    window.addEventListener('pointermove', this.onPointerMove, { passive: true });
    window.addEventListener('pointerout', this.onPointerOut, { passive: true });
  }

  unmount(): void {
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerout', this.onPointerOut);
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.host.remove();
  }

  /** Shows `entries` for the timeline in `rangeEl`. Cheap to call when nothing changed. */
  setEntries(entries: Entry[], rangeEl: Element): void {
    const changed =
      entries.length !== this.items.length ||
      entries.some((e, i) => !sameKey(itemKey(e), itemKey((this.items[i] as Item).entry)));
    const rangeChanged = rangeEl !== this.rangeEl;
    this.rangeEl = rangeEl;
    if (changed) {
      this.rebuild(entries);
    } else {
      entries.forEach((entry, i) => {
        const item = this.items[i] as Item;
        item.entry = entry;
        setText(item.label, '.time', describeEntry(entry).shortTime ?? '');
      });
    }
    // Measuring every item forces a page layout, so only do it when something new appeared. Size
    // changes (images loading, comments expanding) arrive separately, through relayout().
    if (changed || rangeChanged) this.relayout();
  }

  /** Re-measures the page. Call when page height or layout changes. */
  relayout(): void {
    for (const item of this.items) {
      item.span = this.geometry.spanOf(item.entry.el);
      item.dot.hidden = !item.span;
    }
    this.placed = this.items.filter((item) => item.span);
    this.quiet = quietStretches(this.placed.map((item) => item.entry));
    this.lastLayoutKey = '';
    this.box = null;
    this.updateViewport();
  }

  /** Moves the timeline, the on-screen highlights and the labelled section. Call on scroll. */
  updateViewport(): void {
    const top = this.geometry.scrollTop();
    const viewportHeight = this.geometry.viewportHeight();
    const bottom = top + viewportHeight;
    const quietRoom = Math.max(0, this.placed.length - 1) * MAX_DOT_PITCH;
    const lineHeight = Math.round(
      Math.min(viewportHeight * LINE_FRACTION, quietRoom + this.quiet.length * BREAK_ROOM),
    );

    let pageFocus = -1;
    let lastAbove = 0;
    this.placed.forEach((item, i) => {
      const span = item.span as Span;
      const onScreen = span.bottom > top && span.top < bottom;
      item.dot.classList.toggle('on-screen', onScreen);
      item.label.classList.toggle('on-screen', onScreen);
      if (onScreen && pageFocus < 0) pageFocus = i;
      if (span.top < top) lastAbove = i;
    });
    // On a really long PR, the labelled section follows what you're reading. Otherwise every entry
    // is labelled and scrolling can't change the layout.
    const focus = pageFocus >= 0 ? pageFocus : lastAbove;
    const gaps = this.placed.length - 1;
    const sectioned = gaps * FAN.minLabelPitch > lineHeight + 2 * FAN.maxOverhang;

    // Laying out touches every dot, so only do it when the result can differ.
    const layoutKey = `${this.placed.length}:${sectioned ? focus : 'all'}:${lineHeight}`;
    if (layoutKey !== this.lastLayoutKey) {
      this.lastLayoutKey = layoutKey;
      const after = this.quiet.map((q) => q.after);
      this.render(fanLayout(this.placed.length, focus, lineHeight, FAN, after), lineHeight);
    }

    // Start with the top label level with the conversation (labels reach above the line's top), so
    // nothing covers the repo header or the tabs; once it scrolls up, stick below GitHub's header.
    // Never start so low that the line runs off the bottom of the window.
    const range = this.rangeEl ? this.geometry.spanOf(this.rangeEl) : null;
    const reach = Math.max(0, LABEL_HALF_HEIGHT - (this.layout?.labels[0]?.y ?? 0));
    const lowest = viewportHeight - BOTTOM_GAP - lineHeight;
    const hostTop = Math.max(MIN_TOP, Math.min((range?.top ?? 0) - top + reach, lowest));
    if (hostTop !== this.hostTop) {
      this.hostTop = hostTop;
      this.host.style.top = `${hostTop}px`;
      this.box = null;
    }
  }

  private render(layout: FanLayout, lineHeight: number): void {
    this.layout = layout;
    setStyle(this.timeline, 'height', `${lineHeight}px`);
    const closest = Math.min(...layout.dotYs.slice(1).map((y, i) => y - (layout.dotYs[i] ?? 0)));
    const compact = closest < ICON_MIN_PITCH;
    this.timeline.classList.toggle('compact', compact);
    this.renderBreaks(layout, compact ? COMPACT_DOT : ICON_SIZE + 4);
    this.placed.forEach((item, i) => {
      setData(item.label, 'index', String(i));
    });
    // Only labels that come or go are touched: on a long PR the labelled section shifts one entry
    // at a time as the page scrolls.
    const labelled = new Set(layout.labels.map(({ index }) => this.placed[index]));
    for (const item of this.items) {
      const hide = !labelled.has(item);
      if (item.label.hidden !== hide) item.label.hidden = hide;
      item.path = null;
    }

    // Connectors are reused rather than recreated, so shifting the section only reshapes them.
    while (this.paths.length < layout.labels.length) {
      const path = document.createElementNS(SVG_NS, 'path');
      this.connectors.append(path);
      this.paths.push(path);
    }
    while (this.paths.length > layout.labels.length) this.paths.pop()?.remove();
    layout.labels.forEach(({ index }, j) => {
      const item = this.placed[index] as Item;
      const path = this.paths[j] as SVGPathElement;
      setData(path, 'index', String(index));
      setData(path, 'tone', item.dot.dataset.tone ?? '');
      path.classList.toggle('hot', item.dot.classList.contains('hot'));
      item.path = path;
    });
    this.paint();
  }

  /** Positions dots, labels and connectors: the resting layout, magnified around the pointer. */
  private paint(): void {
    const { layout } = this;
    if (!layout) return;
    // Ends pinned: magnifying only shares out space along the line and the label column, so
    // nothing ever moves past their ends (and into the eye above the line).
    const lineEnd = layout.dotYs.at(-1) ?? 0;
    const dots = magnify(layout.dotYs, this.pointer, this.strength, DOCK_DOTS, {
      top: 0,
      bottom: lineEnd,
    });
    const labelYs = layout.labels.map((l) => l.y);
    const labels = magnify(labelYs, this.pointer, this.strength, DOCK_LABELS, {
      top: labelYs[0] ?? 0,
      bottom: labelYs.at(-1) ?? 0,
    });

    // Writes are skipped when nothing changed, so items far from the pointer cost nothing.
    this.placed.forEach((item, i) => {
      setStyle(item.dot, 'top', px(dots.positions[i] ?? 0));
      setScale(item.dot, dots.scales[i] ?? 1);
    });
    // The line runs from the first dot to the last, with nothing past either end.
    const first = dots.positions[0] ?? 0;
    const last = dots.positions.at(-1) ?? 0;
    setStyle(this.line, 'top', px(LINE_ZONE_PAD + first));
    setStyle(this.line, 'height', px(this.placed.length > 1 ? last - first : 0));
    // Each break sits halfway between the two events either side of its quiet stretch.
    this.quiet.forEach(({ after }, j) => {
      const y = ((dots.positions[after] ?? 0) + (dots.positions[after + 1] ?? 0)) / 2;
      setStyle(this.breaks[j] as HTMLElement, 'top', px(y));
    });

    layout.labels.forEach(({ index }, j) => {
      const item = this.placed[index] as Item;
      item.labelY = labels.positions[j] ?? 0;
      item.labelScale = labels.scales[j] ?? 1;
      setStyle(item.label, 'top', px(item.labelY));
      setScale(item.label, item.labelScale);
      const d = connectorPath(dots.positions[index] ?? 0, item.labelY);
      if (item.path && item.path.getAttribute('d') !== d) item.path.setAttribute('d', d);
    });
    this.placeTooltip();
  }

  /**
   * One mark per quiet stretch, reused from one layout to the next. Each leaves as big a gap in the
   * line as fits between the events either side (they're all spaced alike), and the time is
   * written in the gap, or beside the line when the gap is too small.
   */
  private renderBreaks(layout: FanLayout, dotSize: number): void {
    const first = this.quiet[0];
    if (first) {
      const step = (layout.dotYs[first.after + 1] ?? 0) - (layout.dotYs[first.after] ?? 0);
      const gap = Math.max(4, Math.min(BREAK_GAP_MAX, step - dotSize - 2 * BREAK_CLEARANCE));
      setStyle(this.timeline, '--gap', px(gap));
      this.timeline.classList.toggle('tight-breaks', gap < BREAK_LABEL_MIN_GAP);
    }
    while (this.breaks.length < this.quiet.length) {
      const mark = document.createElement('div');
      mark.className = 'break';
      mark.setAttribute('aria-hidden', 'true');
      // Under the dots, so a mark on a crowded line never covers an event.
      this.line.after(mark);
      this.breaks.push(mark);
    }
    while (this.breaks.length > this.quiet.length) this.breaks.pop()?.remove();
    this.quiet.forEach(({ label }, j) => {
      const mark = this.breaks[j] as HTMLElement;
      if (mark.textContent === label) return;
      mark.innerHTML = '<i class="slash"></i><i class="slash"></i><span class="quiet"></span>';
      setText(mark, '.quiet', label);
    });
  }

  /**
   * Pointer moves arrive far more often than frames, and from anywhere on the page. Moves that are
   * clearly nowhere near a resting timeline are dropped; the rest are handled once per frame.
   */
  private trackPointer(e: MouseEvent): void {
    this.pointerClient = { x: e.clientX, y: e.clientY };
    const resting = this.strength === 0 && this.targetStrength === 0;
    if (resting && this.box && !this.isOver(this.box, e.clientX, e.clientY)) return;
    this.follow();
  }

  /** Brings the hover state up to date with the pointer: now in tests, otherwise next frame. */
  private follow(): void {
    if (this.options.animate === false) {
      this.updateHover();
      this.strength = this.targetStrength;
      this.paint();
    } else if (!this.frame) {
      this.frame = requestAnimationFrame(this.tick);
    }
  }

  private isOver(box: DOMRect, x: number, y: number): boolean {
    const reach = FAN.maxOverhang + HOVER_SLOP;
    return (
      x >= box.left - HOVER_SLOP &&
      x <= box.right + HOVER_SLOP &&
      y >= box.top - reach &&
      y <= box.bottom + reach
    );
  }

  /** Points the magnification at the pointer while it's over the timeline, or lets it go. */
  private updateHover(): void {
    const p = this.pointerClient;
    let over = false;
    if (p && this.visible && this.layout && !reducedMotion?.matches) {
      this.box ??= this.timeline.getBoundingClientRect();
      over = this.isOver(this.box, p.x, p.y);
      if (over) this.pointer = p.y - this.box.top;
    }
    this.targetStrength = over ? 1 : 0;
  }

  /** One animation frame: follow the pointer, ease the magnification, repaint. */
  private readonly tick = (now: number): void => {
    const pointerBefore = this.pointer;
    const strengthBefore = this.strength;
    this.updateHover();
    const elapsed = this.lastFrameTime ? now - this.lastFrameTime : 16;
    this.lastFrameTime = now;
    const step = 1 - Math.exp(-elapsed / DOCK_EASE_MS);
    this.strength += (this.targetStrength - this.strength) * step;
    if (Math.abs(this.targetStrength - this.strength) < 0.005) this.strength = this.targetStrength;
    if (this.strength !== strengthBefore || (this.strength > 0 && this.pointer !== pointerBefore)) {
      this.paint();
    }
    if (this.strength === this.targetStrength) {
      this.frame = 0;
      this.lastFrameTime = 0;
    } else {
      this.frame = requestAnimationFrame(this.tick);
    }
  };

  private rebuild(entries: Entry[]): void {
    this.hideTooltip();
    const labels = this.shadowRoot.querySelector('.labels') as HTMLElement;
    labels.replaceChildren();
    for (const item of this.items) item.dot.remove();

    this.items = entries.map((entry) => {
      const d = describeEntry(entry);
      const ariaLabel = d.time ? `${d.summary}, ${d.time}` : d.summary;

      const label = document.createElement('button');
      label.type = 'button';
      label.className = 'label';
      label.setAttribute('aria-label', ariaLabel);
      if (d.isBot) label.dataset.bot = '';
      const who = d.who ? `<span class="who"></span>` : '';
      const bot = d.isBot ? `<span class="bot-tag">bot</span>` : '';
      label.innerHTML = `${who}${bot}<span class="what"></span><span class="time"></span>`;
      setText(label, '.who', d.who ?? '');
      setText(label, '.what', d.what);
      setText(label, '.time', d.shortTime ?? '');

      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'dot';
      dot.tabIndex = -1; // the label is the keyboard target; the dot is a pointer shortcut
      dot.setAttribute('aria-label', ariaLabel);
      dot.dataset.kind = entry.kind;
      dot.dataset.tone = d.tone;
      dot.dataset.icon = d.icon;
      dot.innerHTML = glyph(d.icon);
      if (d.isBot) dot.dataset.bot = '';

      const item: Item = { entry, label, dot, span: null, path: null, labelY: 0, labelScale: 1 };
      for (const el of [label, dot]) {
        el.addEventListener('click', () => this.onItemClick(item.entry));
        el.addEventListener('pointerleave', () => this.unhighlight(item));
      }
      // Only the label shows the detail tooltip. Over a dot it would cover the labels you're
      // reading while running the pointer along the line.
      label.addEventListener('pointerenter', () => this.highlight(item, true));
      dot.addEventListener('pointerenter', () => this.highlight(item, false));
      label.addEventListener('focus', () => this.highlight(item, true));
      label.addEventListener('blur', () => this.unhighlight(item));

      labels.append(label);
      this.lineZone.append(dot);
      return item;
    });
  }

  /** Lights up a label, its dot and the connector between them, and maybe shows the detail. */
  private highlight(item: Item, withTooltip: boolean): void {
    item.label.classList.add('hot');
    item.dot.classList.add('hot');
    item.path?.classList.add('hot');
    if (withTooltip) this.showTooltip(item);
  }

  private unhighlight(item: Item): void {
    item.label.classList.remove('hot');
    item.dot.classList.remove('hot');
    item.path?.classList.remove('hot');
    this.hideTooltip();
  }

  private onItemClick(entry: Entry): void {
    const span = this.geometry.spanOf(entry.el);
    if (span) this.geometry.scrollTo(Math.max(0, span.top - SCROLL_OFFSET));
    flash(entry.el);
    if (entry.kind === 'hidden') this.options.onHiddenClick?.(entry);
  }

  /** The eye shows or hides the whole timeline; the eye itself always stays. */
  private setVisible(visible: boolean, remember: boolean): void {
    this.visible = visible;
    if (!visible) {
      this.strength = 0;
      this.targetStrength = 0;
      this.paint();
    }
    // Faded rather than display:none, so the change can animate; inert keeps a faded timeline out
    // of the way of clicks and keyboard focus.
    this.timeline.classList.toggle('faded', !visible);
    this.timeline.toggleAttribute('inert', !visible);
    this.eye.setAttribute('aria-pressed', String(visible));
    this.eye.setAttribute(
      'aria-label',
      visible ? 'Hide activity timeline' : 'Show activity timeline',
    );
    this.eye.title = visible ? 'Hide activity timeline' : 'Show activity timeline';
    this.eye.innerHTML = icon(visible ? 'eye' : 'eye-closed');
    this.hideTooltip();
    if (remember) {
      try {
        this.storage?.setItem(HIDDEN_KEY, visible ? '0' : '1');
      } catch {
        // Storage can be unavailable (blocked site data); the choice just won't stick.
      }
    }
  }

  private readHidden(): boolean {
    try {
      return this.storage?.getItem(HIDDEN_KEY) === '1';
    } catch {
      return false;
    }
  }

  private showTooltip(item: Item): void {
    const { summary, time, detail } = describeEntry(item.entry);
    const heading = document.createElement('div');
    heading.className = 'tooltip-title';
    heading.textContent = summary;
    if (time) {
      const when = document.createElement('span');
      when.className = 'tooltip-time';
      when.textContent = ` · ${time}`;
      heading.append(when);
    }
    const body = document.createElement('div');
    body.className = 'tooltip-detail';
    body.textContent = detail;
    body.hidden = !detail;
    this.tooltip.replaceChildren(heading, body);
    this.tooltipItem = item;
    this.tooltipWidth = item.label.offsetWidth;
    this.placeTooltip();
    this.tooltip.hidden = false;
  }

  /**
   * Just left of the hovered label, following it as the magnification grows or shrinks it. Worked
   * out from where the label was painted, so following it costs no layout.
   */
  private placeTooltip(): void {
    const item = this.tooltipItem;
    if (!item) return;
    setStyle(this.tooltip, 'top', px(item.labelY));
    setStyle(this.tooltip, 'right', px(LABEL_RIGHT + this.tooltipWidth * item.labelScale + 8));
  }

  private hideTooltip(): void {
    this.tooltipItem = null;
    this.tooltip.hidden = true;
  }
}

/**
 * A connector from a dot (on the line, x = CONNECTOR_WIDTH) to its label's right end (x = 0). It
 * leaves the dot sideways, bends, and arrives at the label sideways, so a run of them fans out.
 */
function connectorPath(dotY: number, labelY: number): string {
  const start = CONNECTOR_WIDTH - 6;
  const a = round(dotY);
  const b = round(labelY);
  return `M ${start} ${a} C ${start - 12} ${a}, 12 ${b}, 0 ${b}`;
}

/** Rounded to 0.1px: finer than the eye can see, coarse enough to skip writes that change nothing. */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function px(value: number): string {
  return `${round(value)}px`;
}

/** Sets a data attribute only when it changes. */
function setData(el: HTMLElement | SVGElement, key: string, value: string): void {
  if (el.dataset[key] !== value) el.dataset[key] = value;
}

/** Sets an inline style only when it changes. */
function setStyle(el: HTMLElement, property: string, value: string): void {
  if (el.style.getPropertyValue(property) !== value) el.style.setProperty(property, value);
}

/** Sets an element's magnification, used by its CSS transform. */
function setScale(el: HTMLElement, scale: number): void {
  const value = scale === 1 ? '' : scale.toFixed(3);
  if (el.style.getPropertyValue('--m') === value) return;
  if (value) el.style.setProperty('--m', value);
  else el.style.removeProperty('--m');
}

const reducedMotion =
  typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

/** Identity of an item: same key means the existing label and dot can stay as they are. */
function itemKey(entry: Entry): unknown[] {
  switch (entry.kind) {
    case 'changes':
      return [entry.kind, entry.el, entry.commits.length, entry.forcePushes.length];
    case 'review':
      return [entry.kind, entry.el, entry.state];
    case 'hidden':
      return [entry.kind, entry.el, entry.count];
    default:
      return [entry.kind, entry.el];
  }
}

function sameKey(a: unknown[], b: unknown[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** An event's icon. Stroked, so its colour and weight come from CSS. */
function glyph(name: NodeIcon): string {
  return `<svg class="glyph" viewBox="0 0 24 24" aria-hidden="true">${NODE_ICONS[name]}</svg>`;
}

function icon(name: IconName): string {
  return `<svg class="icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="${ICONS[name]}"></path></svg>`;
}

function setText(root: Element, selector: string, text: string): void {
  const el = root.querySelector(selector);
  if (el) el.textContent = text;
}

function defaultStorage(): KeyValueStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Briefly outlines the item scrolled to, so the eye lands on it. */
function flash(el: Element): void {
  el.animate?.(
    [
      { boxShadow: '0 0 0 3px var(--fgColor-accent, #0969da)', borderRadius: '6px' },
      { boxShadow: '0 0 0 3px transparent', borderRadius: '6px' },
    ],
    { duration: 1200, easing: 'ease-out' },
  );
}

// Colours come from GitHub's Primer CSS variables, which inherit into the shadow root, so the
// timeline follows GitHub's light/dark theme. The fallbacks are Primer's light values.
const STYLES = `
:host {
  all: initial;
  position: fixed;
  top: ${MIN_TOP}px;
  right: 16px;
  width: 248px;
  z-index: 29;
  font: 12.5px/1.5 "${SANS}", -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", Helvetica, Arial, sans-serif;
  color: var(--fgColor-default, #1f2328);
  --page-bg: var(--bgColor-default, #fff);
  --line: var(--borderColor-default, #d1d9e0);
  /* No box: only the line, dots, labels and eye take clicks; the page shows through the rest. */
  pointer-events: none;
}
.eye, .label, .dot { pointer-events: auto; }
/* Clear of the line's top end, which never moves, even while magnifying. */
.eye {
  position: absolute; z-index: 2; top: -36px; right: ${LINE_RIGHT - 11}px;
  display: grid; place-items: center; width: 22px; height: 22px; padding: 0;
  border: 0; border-radius: 50%; background: var(--page-bg); cursor: pointer;
  color: var(--fgColor-muted, #59636e);
}
.eye:hover { color: var(--fgColor-default, #1f2328); background: var(--bgColor-neutral-muted, #818b981f); }
.eye:focus-visible { outline: 2px solid var(--focus-outlineColor, #0969da); }
.eye[aria-pressed="false"] { opacity: 0.7; }
.icon { fill: currentColor; }
/* Showing eases in; hiding eases out, then turns invisible once the fade has finished. */
.timeline {
  position: relative; display: block; --gap: ${BREAK_GAP_MAX}px;
  transition:
    opacity 220ms cubic-bezier(0.2, 0, 0, 1),
    transform 220ms cubic-bezier(0.2, 0, 0, 1),
    visibility 0s linear 0s;
}
.timeline.faded {
  opacity: 0; transform: translateX(12px); visibility: hidden;
  transition:
    opacity 180ms cubic-bezier(0.4, 0, 1, 1),
    transform 180ms cubic-bezier(0.4, 0, 1, 1),
    visibility 0s linear 180ms;
}
@media (prefers-reduced-motion: reduce) {
  .timeline, .timeline.faded { transition: none; }
}

/* The line and its dots. Only the dots take clicks; the strip itself lets them through. */
.line-zone {
  position: absolute; top: -${LINE_ZONE_PAD}px; bottom: -${LINE_ZONE_PAD}px; right: ${LINE_RIGHT - 12}px; width: 24px;
}
.line {
  position: absolute; top: ${LINE_ZONE_PAD}px; left: 11px; width: 2px; border-radius: 1px;
  background: var(--line);
}
.dot {
  --c: var(--fgColor-muted, #59636e);
  position: absolute; left: 12px; margin-top: ${LINE_ZONE_PAD}px;
  transform: translate(-50%, -50%) scale(var(--m, 1));
  /* The icon sits on a page-coloured disc, so the line doesn't run through it. */
  display: grid; place-items: center;
  width: ${ICON_SIZE + 4}px; height: ${ICON_SIZE + 4}px; padding: 0; border: 0; border-radius: 50%;
  background: var(--page-bg); color: var(--c); cursor: pointer;
}
.dot[hidden] { display: none; }
[data-tone="accent"] { --c: var(--fgColor-accent, #0969da); }
[data-tone="success"] { --c: var(--fgColor-success, #1a7f37); }
[data-tone="danger"] { --c: var(--fgColor-danger, #d1242f); }
[data-tone="attention"] { --c: var(--fgColor-attention, #9a6700); }
[data-tone="done"] { --c: var(--fgColor-done, #8250df); }
[data-tone="open"] { --c: var(--fgColor-open, #1a7f37); }
[data-tone="closed"] { --c: var(--fgColor-closed, #d1242f); }
[data-tone="muted"] { --c: var(--fgColor-muted, #59636e); }
.glyph {
  width: ${ICON_SIZE}px; height: ${ICON_SIZE}px;
  fill: none; stroke: currentColor; stroke-width: 2.25; stroke-linecap: round; stroke-linejoin: round;
}
.dot.on-screen { background: color-mix(in srgb, var(--c) 18%, var(--page-bg)); }
.dot.hot { box-shadow: 0 0 0 1.5px var(--c); z-index: 1; }
/* Too crowded for icons: small dots in each event's colour, hollow for bots. */
.compact .dot { width: 8px; height: 8px; background: var(--c); box-shadow: none; }
.compact .glyph { display: none; }
.compact .dot[data-bot] { background: var(--page-bg); box-shadow: inset 0 0 0 2px var(--c); }
.compact .dot.on-screen, .compact .dot.hot { outline: 2px solid var(--c); outline-offset: 2px; z-index: 1; }

/* A quiet stretch of a day or more: a gap in the line between two slashes, with how long it
   lasted written in the gap. --gap is set to what fits between the events either side. */
.break { position: absolute; left: 12px; margin-top: ${LINE_ZONE_PAD}px; pointer-events: none; }
.break::before {
  content: ""; position: absolute; left: -3px; top: calc(var(--gap) / -2);
  width: 6px; height: var(--gap); background: var(--page-bg);
}
.slash {
  position: absolute; left: -4.5px; top: calc(var(--gap) / -2 - 0.75px);
  width: 9px; height: 1.5px; border-radius: 1px; transform: rotate(-25deg);
  background: var(--borderColor-emphasis, #818b98);
}
.slash + .slash { top: calc(var(--gap) / 2 - 0.75px); }
.quiet {
  position: absolute; left: 0; top: 0; transform: translate(-50%, -50%);
  font: 300 9.5px/1 "${MONO}", ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--fgColor-muted, #59636e); white-space: nowrap;
}
/* No room to write in the gap: the time sits beside the line instead. */
.tight-breaks .quiet { left: 8px; transform: translateY(-50%); }

/* Connectors fan out from the dots to the labels. */
.connectors {
  position: absolute; top: 0; right: ${LINE_RIGHT}px; width: ${CONNECTOR_WIDTH}px; height: 100%;
  overflow: visible; pointer-events: none;
}
.connectors path {
  fill: none; stroke: var(--borderColor-emphasis, #818b98); stroke-opacity: 0.6; stroke-width: 1;
}
.connectors path.hot { stroke: var(--c); stroke-opacity: 1; stroke-width: 1.5; }

/* Each label carries its own page-coloured background, so it stays readable over whatever is
   under it without a box around the whole timeline. */
.label {
  position: absolute; right: ${LABEL_RIGHT}px;
  transform: translateY(-50%) scale(var(--m, 1)); transform-origin: right center;
  display: flex; gap: 4px; align-items: baseline; justify-content: flex-end;
  max-width: calc(100% - ${LABEL_RIGHT}px);
  height: ${LABEL_HALF_HEIGHT * 2}px; padding: 0 6px; border: 0; border-radius: 6px;
  background: var(--page-bg);
  font: inherit; line-height: ${LABEL_HALF_HEIGHT * 2}px; color: inherit; white-space: nowrap;
  cursor: pointer;
}
.label[hidden] { display: none; }
.label:hover, .label.hot { background: var(--bgColor-muted, #f6f8fa); }
.label.on-screen { background: var(--bgColor-accent-muted, #ddf4ff); }
.label:focus-visible { outline: 2px solid var(--focus-outlineColor, #0969da); outline-offset: -2px; }
/* Long names truncate; the verb never does, since it's what the label is about. */
.who { font-weight: 600; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.what { flex: none; }
.what:empty { display: none; }
.label[data-bot] { color: var(--fgColor-muted, #59636e); }
.bot-tag {
  flex: none; padding: 0 4px; border: 1px solid var(--borderColor-default, #d1d9e0);
  border-radius: 999px; font-size: 10px; line-height: 14px; color: var(--fgColor-muted, #59636e);
}
/* How long ago: a light mono, quieter than the label it follows. */
.time {
  flex: none; margin-left: 3px; font: 300 10.5px/18px "${MONO}", ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--fgColor-muted, #59636e); opacity: 0.8; letter-spacing: -0.02em;
}

.tooltip {
  position: absolute; transform: translateY(-50%);
  width: max-content; max-width: 300px; padding: 6px 8px; pointer-events: none;
  background: var(--overlay-bgColor, #fff);
  border: 1px solid var(--borderColor-default, #d1d9e0); border-radius: 6px;
  box-shadow: var(--shadow-floating-small, 0 6px 12px -3px #25292e0a, 0 6px 18px 0 #25292e1f);
}
.tooltip[hidden], .tooltip-detail[hidden] { display: none; }
.tooltip-title { font-weight: 600; }
.tooltip-time { font: 300 11px "${MONO}", ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--fgColor-muted, #59636e); }
.tooltip-detail {
  margin-top: 2px; color: var(--fgColor-muted, #59636e); white-space: pre-line;
  overflow-wrap: anywhere;
}
`;
