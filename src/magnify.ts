export interface MagnifyOptions {
  /** How far from the pointer the magnification reaches, in px. */
  radius: number;
  /** Size of whatever is right under the pointer, at full strength. */
  maxScale: number;
}

export interface Magnified {
  positions: number[];
  scales: number[];
}

/**
 * macOS Dock-style magnification along a vertical axis. Around the pointer the axis is stretched:
 * scale falls smoothly from `maxScale` at the pointer to 1 at `radius` away (a cosine bump), and
 * each position moves by the stretch between it and the pointer. So the item under the pointer
 * stays put, its neighbours spread apart, and items beyond the radius keep their size and shift
 * outward to make room. `strength` (0..1) eases the whole effect in and out.
 *
 * With `bounds`, it's a local lens instead: within two radii of the pointer (and never past the
 * bounds), each side is squeezed back to its original length, so the space near the pointer is
 * borrowed from the edges of the lens. Nothing moves past either bound, and everything outside the
 * lens stays exactly where it was.
 */
export function magnify(
  base: number[],
  pointer: number,
  strength: number,
  { radius, maxScale }: MagnifyOptions,
  bounds?: { top: number; bottom: number },
): Magnified {
  const extra = (maxScale - 1) * strength;
  if (extra === 0) return { positions: [...base], scales: base.map(() => 1) };

  // With pinned ends, a pointer past an end magnifies around that end.
  const centre = bounds ? Math.min(Math.max(pointer, bounds.top), bounds.bottom) : pointer;
  const scales = base.map((y) => {
    const t = Math.abs(y - centre) / radius;
    return t >= 1 ? 1 : 1 + (extra * (1 + Math.cos(Math.PI * t))) / 2;
  });

  // Distance from the centre after stretching: the integral of the scale over the original
  // distance d, which has a closed form for the cosine bump.
  const stretched = (d: number) =>
    d +
    extra *
      (d >= radius
        ? radius / 2
        : d / 2 + (radius / (2 * Math.PI)) * Math.sin((Math.PI * d) / radius));
  if (!bounds) {
    const positions = base.map((y) => {
      const d = y - centre;
      return d < 0 ? centre - stretched(-d) : centre + stretched(d);
    });
    return { positions, scales };
  }

  // The lens: each side squeezed back to its original length, so its edges don't move.
  const lensTop = Math.max(bounds.top, centre - 2 * radius);
  const lensBottom = Math.min(bounds.bottom, centre + 2 * radius);
  const squeeze = (span: number) => (span > 0 ? span / stretched(span) : 1);
  const above = squeeze(centre - lensTop);
  const below = squeeze(lensBottom - centre);
  const positions = base.map((y) => {
    if (y <= lensTop || y >= lensBottom) return y;
    const d = y - centre;
    return d < 0 ? centre - stretched(-d) * above : centre + stretched(d) * below;
  });
  return { positions, scales };
}
