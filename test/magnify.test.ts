import { magnify } from '../src/magnify';

const OPTS = { radius: 100, maxScale: 2 };
const BASE = [0, 50, 100, 150, 200, 250, 300, 350, 400];

describe('magnify', () => {
  // Not hovering (strength 0): everything stays exactly where and how big it was.
  it('leaves everything alone at zero strength', () => {
    expect(magnify(BASE, 200, 0, OPTS)).toEqual({ positions: BASE, scales: BASE.map(() => 1) });
  });

  // Like the macOS Dock: the item under the pointer grows to the full magnification and stays
  // under the pointer, so whatever you're pointing at doesn't slide away.
  it('grows the item under the pointer and keeps it there', () => {
    const { positions, scales } = magnify(BASE, 200, 1, OPTS);
    expect(scales[4]).toBe(2);
    expect(positions[4]).toBe(200);
  });

  // Its neighbours are pushed away from the pointer to make room: those above move up, those below
  // move down, and the gaps next to the pointer grow.
  it('pushes neighbours apart, away from the pointer', () => {
    const { positions } = magnify(BASE, 200, 1, OPTS);
    expect(positions[3]).toBeLessThan(150);
    expect(positions[5]).toBeGreaterThan(250);
    expect((positions[5] ?? 0) - (positions[4] ?? 0)).toBeGreaterThan(50);
  });

  // Beyond the radius, items keep their normal size and spacing; they just shift outward as a block
  // (by half the radius at full magnification) to make room for the magnified part.
  it('leaves items beyond the radius their size, shifted outward', () => {
    const { positions, scales } = magnify(BASE, 200, 1, OPTS);
    expect(scales[0]).toBe(1);
    expect(scales[8]).toBe(1);
    expect(positions[0]).toBeCloseTo(-50);
    expect(positions[8]).toBeCloseTo(450);
    expect((positions[1] ?? 0) - (positions[0] ?? 0)).toBeCloseTo(50);
  });

  // While easing in or out (strength between 0 and 1), the magnification is partial, so the effect
  // grows and shrinks smoothly instead of popping.
  it('magnifies partway at partial strength', () => {
    expect(magnify(BASE, 200, 0.5, OPTS).scales[4]).toBe(1.5);
  });

  // Pinned between two ends (the ends of the timeline's line): the ends never move, wherever the
  // pointer is. Space near the pointer still grows; it's taken from the parts further away. This is
  // what stops the timeline from ever growing over the eye icon above it.
  it('keeps pinned ends in place while still magnifying near the pointer', () => {
    for (const pointer of [-80, 0, 37, 200, 333, 400, 480]) {
      const { positions } = magnify(BASE, pointer, 1, OPTS, { top: 0, bottom: 400 });
      expect(positions[0], `pointer at ${pointer}`).toBeCloseTo(0);
      expect(positions[8], `pointer at ${pointer}`).toBeCloseTo(400);
    }
    const { positions } = magnify(BASE, 200, 1, OPTS, { top: 0, bottom: 400 });
    expect(positions[4]).toBeCloseTo(200);
    expect((positions[5] ?? 0) - (positions[4] ?? 0)).toBeGreaterThan(50);
    expect((positions[1] ?? 0) - (positions[0] ?? 0)).toBeLessThan(50);
  });

  // Pinned, the magnification is a local lens: only things within two radii of the pointer move.
  // Everything further away stays perfectly still, which is calmer to look at and means far fewer
  // elements change on each frame.
  it('leaves everything outside the lens untouched', () => {
    const long = Array.from({ length: 21 }, (_, i) => i * 50);
    const { positions } = magnify(long, 500, 1, OPTS, { top: 0, bottom: 1000 });
    positions.forEach((y, i) => {
      const base = long[i] ?? 0;
      if (Math.abs(base - 500) >= 200) expect(y, `item at ${base}`).toBe(base);
    });
    expect(positions[10]).toBeCloseTo(500);
    expect((positions[11] ?? 0) - (positions[10] ?? 0)).toBeGreaterThan(50);
  });

  // Nothing ever swaps places, wherever the pointer is.
  it('keeps everything in order', () => {
    for (const pointer of [-50, 0, 37, 200, 333, 400, 480]) {
      for (const bounds of [undefined, { top: 0, bottom: 400 }]) {
        const { positions } = magnify(BASE, pointer, 1, OPTS, bounds);
        positions.slice(1).forEach((y, i) => {
          expect(y, `pointer at ${pointer}`).toBeGreaterThan(positions[i] ?? 0);
        });
      }
    }
  });
});
