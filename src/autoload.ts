/**
 * - requested: GitHub took the request and is loading the items.
 * - not-ready: nothing handled it (GitHub's script isn't attached yet); try again later.
 * - skipped: already requested, or the load cap was reached.
 */
export type LoadResult = 'requested' | 'not-ready' | 'skipped';

/**
 * Asks GitHub to load the items hidden behind "N hidden items / Load more…" on long PRs.
 *
 * GitHub's own script intercepts the form's submit event and fetches the items. We dispatch a
 * synthetic submit rather than clicking the button: synthetic events can never trigger a real
 * submission, so if GitHub's script isn't listening yet, nothing happens. A real click would
 * navigate the tab to a bare HTML fragment instead.
 */
export class HiddenItemsLoader {
  private readonly requested = new WeakSet<Element>();
  private loads = 0;

  constructor(private readonly maxLoads = 50) {}

  load(form: Element): LoadResult {
    if (this.requested.has(form) || this.loads >= this.maxLoads) return 'skipped';

    const submitter =
      [...form.querySelectorAll('button')].find((b) => /load more/i.test(b.textContent ?? '')) ??
      null;
    const event = new SubmitEvent('submit', { bubbles: true, cancelable: true, submitter });
    form.dispatchEvent(event);

    // GitHub's handler cancels the event to stop the browser's own submission.
    if (!event.defaultPrevented) return 'not-ready';
    this.requested.add(form);
    this.loads++;
    return 'requested';
  }
}
