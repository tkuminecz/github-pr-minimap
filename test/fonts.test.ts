import { createFontLoader, FONTS, type FontDeps } from '../src/fonts';

function fakeDeps(failing: string[] = []) {
  const added: { family: string; weight: string; bytes: number }[] = [];
  const deps: FontDeps = {
    url: (path) => `chrome-extension://abc/${path}`,
    fetchBytes: vi.fn(async (url: string) => {
      if (failing.some((f) => url.endsWith(f))) throw new Error('blocked');
      return new ArrayBuffer(url.length);
    }),
    addFace: vi.fn(async (family: string, data: ArrayBuffer, weight: string) => {
      added.push({ family, weight, bytes: data.byteLength });
    }),
  };
  return { deps, added };
}

describe('createFontLoader', () => {
  // The labels use a condensed sans and the times a light mono; each face comes from the files
  // shipped inside the extension, with its weight.
  it('loads each bundled font face from the extension', async () => {
    const { deps, added } = fakeDeps();
    await createFontLoader(deps)();
    expect(added.map(({ family, weight }) => `${family} ${weight}`)).toEqual(
      FONTS.map(({ family, weight }) => `${family} ${weight}`),
    );
    expect(deps.fetchBytes).toHaveBeenCalledWith(`chrome-extension://abc/${FONTS[0]?.file}`);
  });

  // The content script runs on every page change; the fonts are only fetched once.
  it('loads only once, however often it is asked', async () => {
    const { deps } = fakeDeps();
    const load = createFontLoader(deps);
    await Promise.all([load(), load()]);
    await load();
    expect(deps.fetchBytes).toHaveBeenCalledTimes(FONTS.length);
  });

  // A font that can't load just leaves the system font in place: nothing else may break.
  it('carries on without a font that fails to load', async () => {
    const { deps, added } = fakeDeps([FONTS[0]?.file ?? '']);
    await expect(createFontLoader(deps)()).resolves.toBeUndefined();
    expect(added).toHaveLength(FONTS.length - 1);
  });
});
