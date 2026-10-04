/** Where releases are published, for the update check and the link to them. */
const REPO = 'tkuminecz/github-pr-minimap';
export const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;

const CHECK_EVERY_MS = 12 * 3600 * 1000;
const STORAGE_KEY = 'pr-minimap:latest-release';

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

export interface UpdateDeps {
  now(): number;
  storage: KeyValueStorage | null;
  /** The latest release's version ("0.2.0"), or null when there isn't one. */
  fetchLatest(): Promise<string | null>;
}

interface Checked {
  version: string | null;
  at: number;
}

/**
 * The latest released version, asked of GitHub at most every 12 hours: the extension runs on every
 * PR page, and GitHub allows 60 unauthenticated API calls an hour. Between checks, and when GitHub
 * can't be reached, it answers with what it last heard.
 */
export async function latestVersion(deps: UpdateDeps): Promise<string | null> {
  const last = read(deps.storage);
  if (last && deps.now() - last.at < CHECK_EVERY_MS) return last.version;

  let version = last?.version ?? null;
  try {
    version = (await deps.fetchLatest()) ?? version;
  } catch {
    // Offline or rate-limited: keep what was known, and wait for the next check.
  }
  write(deps.storage, { version, at: deps.now() });
  return version;
}

/** Whether `latest` is a newer version than `current`, comparing each part as a number. */
export function isNewer(latest: string, current: string): boolean {
  const a = parse(latest);
  const b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

function parse(version: string): number[] | null {
  const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  return match ? match.slice(1).map(Number) : null;
}

function read(storage: KeyValueStorage | null): Checked | null {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Checked) : null;
  } catch {
    return null;
  }
}

function write(storage: KeyValueStorage | null, checked: Checked): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(checked));
  } catch {
    // Storage can be unavailable (blocked site data); the next page just asks again.
  }
}

export const browserUpdateDeps: UpdateDeps = {
  now: () => Date.now(),
  storage: (() => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  })(),
  fetchLatest: async () => {
    const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
    const { tag_name } = (await response.json()) as { tag_name?: string };
    return tag_name?.replace(/^v/, '') ?? null;
  },
};
