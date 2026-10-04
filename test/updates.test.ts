import { isNewer, latestVersion, type UpdateDeps } from '../src/updates';

const HOUR = 3600_000;

/** In-memory storage, plus a release feed that counts how often it's asked. */
function deps(latest: string | null | Error, now = 0) {
  const data = new Map<string, string>();
  const fetchLatest = vi.fn(async () => {
    if (latest instanceof Error) throw latest;
    return latest;
  });
  const d: UpdateDeps & { clock: number } = {
    clock: now,
    now: () => d.clock,
    storage: { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) },
    fetchLatest,
  };
  return { d, fetchLatest };
}

describe('isNewer', () => {
  // Versions compare number by number, so 0.10.0 is newer than 0.9.1, which a text comparison
  // would get wrong.
  it('compares versions part by part, as numbers', () => {
    expect(isNewer('0.2.0', '0.1.0')).toBe(true);
    expect(isNewer('0.10.0', '0.9.1')).toBe(true);
    expect(isNewer('1.0.0', '0.99.99')).toBe(true);
    expect(isNewer('0.1.0', '0.1.0')).toBe(false);
    expect(isNewer('0.1.0', '0.2.0')).toBe(false);
  });

  // Anything that isn't a plain version (a tag named something else) is never offered.
  it('ignores versions it cannot read', () => {
    expect(isNewer('nightly', '0.1.0')).toBe(false);
  });
});

describe('latestVersion', () => {
  // The first check asks GitHub for the latest release.
  it('asks for the latest release', async () => {
    const { d } = deps('0.2.0');
    expect(await latestVersion(d)).toBe('0.2.0');
  });

  // The extension runs on every PR page, and GitHub allows 60 unauthenticated API calls an hour,
  // so the answer is kept for 12 hours rather than asked for on every page.
  it('asks at most every 12 hours', async () => {
    const { d, fetchLatest } = deps('0.2.0');
    await latestVersion(d);
    d.clock += 11 * HOUR;
    expect(await latestVersion(d)).toBe('0.2.0');
    expect(fetchLatest).toHaveBeenCalledTimes(1);
    d.clock += 2 * HOUR;
    await latestVersion(d);
    expect(fetchLatest).toHaveBeenCalledTimes(2);
  });

  // Offline, or rate-limited: keep what was known, and don't ask again on every page until the
  // next check is due.
  it('keeps the last answer when GitHub cannot be reached, and waits to ask again', async () => {
    const { d } = deps('0.2.0');
    await latestVersion(d);
    d.clock += 13 * HOUR;
    const failing = vi.fn(async () => {
      throw new Error('offline');
    });
    d.fetchLatest = failing;
    expect(await latestVersion(d)).toBe('0.2.0');
    d.clock += HOUR;
    expect(await latestVersion(d)).toBe('0.2.0');
    expect(failing).toHaveBeenCalledTimes(1);
  });

  // With nothing known and GitHub unreachable, there's simply no answer.
  it('has no answer when the first check fails', async () => {
    const { d } = deps(new Error('offline'));
    expect(await latestVersion(d)).toBeNull();
  });

  // Storage can be unavailable (blocked site data). The check still works; it just isn't kept.
  it('works without storage', async () => {
    const { d } = deps('0.2.0');
    d.storage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(await latestVersion(d)).toBe('0.2.0');
  });
});
