import { HiddenItemsLoader } from '../src/autoload';

/** The "N hidden items / Load more…" form, as GitHub renders it. */
function hiddenItemsForm(): HTMLFormElement {
  const form = document.createElement('form');
  form.className = 'ajax-pagination-form js-ajax-pagination';
  form.action = '/o/r/pull/1/timeline_more_items?after_cursor=a';
  form.method = 'get';
  form.innerHTML = `
    <button type="submit">12 hidden items</button>
    <button type="submit" data-disable-with="Loading…">Load more…</button>`;
  document.body.append(form);
  return form;
}

/** Stands in for GitHub's own script, which intercepts the submit and fetches the items. */
function handleLikeGitHub(form: HTMLFormElement): SubmitEvent[] {
  const seen: SubmitEvent[] = [];
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    seen.push(e as SubmitEvent);
  });
  return seen;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('HiddenItemsLoader', () => {
  // GitHub loads the hidden items when its script sees the form submitted via "Load more". The
  // loader must hand it exactly that: a cancelable submit with the Load more button as submitter.
  it('asks GitHub to load the items and reports that it was handled', () => {
    const form = hiddenItemsForm();
    const seen = handleLikeGitHub(form);
    expect(new HiddenItemsLoader().load(form)).toBe('requested');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.submitter?.textContent).toBe('Load more…');
  });

  // If GitHub's script isn't attached yet, a real submit would navigate the tab to a bare HTML
  // fragment. The loader must never trigger a real submission. It reports "not ready" instead.
  it('never navigates when nothing handles the request', () => {
    const form = hiddenItemsForm();
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit');
    const requestSubmit = vi.spyOn(HTMLFormElement.prototype, 'requestSubmit');
    const click = vi.spyOn(HTMLButtonElement.prototype, 'click');
    expect(new HiddenItemsLoader().load(form)).toBe('not-ready');
    expect(submit).not.toHaveBeenCalled();
    expect(requestSubmit).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });

  // The extension can start before GitHub's script attaches its handler (seen on a live PR). A form
  // that wasn't handled must stay retryable, or auto-load silently never happens.
  it('retries a form once GitHub is ready', () => {
    const form = hiddenItemsForm();
    const loader = new HiddenItemsLoader();
    expect(loader.load(form)).toBe('not-ready');
    const seen = handleLikeGitHub(form);
    expect(loader.load(form)).toBe('requested');
    expect(seen).toHaveLength(1);
  });

  // The loader runs on every page update, and the form stays on the page while its request is in
  // flight. Re-submitting it would fire duplicate requests.
  it('requests each form only once', () => {
    const form = hiddenItemsForm();
    const seen = handleLikeGitHub(form);
    const loader = new HiddenItemsLoader();
    loader.load(form);
    expect(loader.load(form)).toBe('skipped');
    expect(seen).toHaveLength(1);
  });

  // Each load can reveal another "Load more". The cap stops a runaway loop if GitHub keeps
  // returning new forms (an error page, say).
  it('stops after the maximum number of loads', () => {
    const loader = new HiddenItemsLoader(2);
    const results = [1, 2, 3].map(() => {
      const form = hiddenItemsForm();
      handleLikeGitHub(form);
      return loader.load(form);
    });
    expect(results).toEqual(['requested', 'requested', 'skipped']);
  });
});
