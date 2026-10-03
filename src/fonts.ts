/** Font families used by the timeline, named so they can't clash with any of GitHub's. */
export const SANS = 'PR Minimap Plex Sans Condensed';
export const MONO = 'PR Minimap Plex Mono';

/** IBM Plex (SIL Open Font License), shipped in the extension under fonts/. */
export const FONTS = [
  { family: SANS, weight: '400', file: 'fonts/ibm-plex-sans-condensed-latin-400-normal.woff2' },
  { family: SANS, weight: '600', file: 'fonts/ibm-plex-sans-condensed-latin-600-normal.woff2' },
  { family: MONO, weight: '300', file: 'fonts/ibm-plex-mono-latin-300-normal.woff2' },
];

export interface FontDeps {
  url(path: string): string;
  fetchBytes(url: string): Promise<ArrayBuffer>;
  addFace(family: string, data: ArrayBuffer, weight: string): Promise<void>;
}

/**
 * The fonts are handed to the page as bytes rather than URLs: GitHub's content security policy
 * only allows fonts from its own servers, and a font made from bytes isn't a download it can block.
 */
export const browserFontDeps: FontDeps = {
  url: (path) => chrome.runtime.getURL(path),
  fetchBytes: async (url) => (await fetch(url)).arrayBuffer(),
  addFace: async (family, data, weight) => {
    const face = new FontFace(family, data, { weight, style: 'normal' });
    document.fonts.add(await face.load());
  },
};

/** Returns a function that loads the fonts the first time it's called and does nothing after. */
export function createFontLoader(deps: FontDeps = browserFontDeps): () => Promise<void> {
  let loading: Promise<void> | null = null;
  return () => {
    loading ??= Promise.all(
      FONTS.map(async ({ family, weight, file }) => {
        try {
          await deps.addFace(family, await deps.fetchBytes(deps.url(file)), weight);
        } catch {
          // Without it, the timeline just uses the system font.
        }
      }),
    ).then(() => undefined);
    return loading;
  };
}
