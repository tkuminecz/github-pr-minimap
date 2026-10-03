import { HiddenItemsLoader } from './autoload';
import { extractEvents } from './extract';
import { currentViewer, filterEvents } from './filter';
import { createFontLoader } from './fonts';
import { groupEntries } from './group';
import { Minimap } from './minimap';
import { isConversationTab } from './route';
import { SETTINGS } from './settings';
import { affectsTimeline } from './watch';

// Runs on every github.com page, because GitHub switches pages without reloading and a content
// script only gets injected on a full load. Each sync checks where we are and shows, updates or
// removes the list to match.

/** Most often a sync may run while the page is busy changing. */
const SYNC_INTERVAL_MS = 150;
/** How long to wait for GitHub's script before asking it to load hidden items again. */
const LOAD_RETRY_MS = 1000;
const MAX_LOAD_RETRIES = 30;

let minimap: Minimap | null = null;
const loadFonts = createFontLoader();
let loader = new HiddenItemsLoader();
let currentPath = '';
let observedRange: Element | null = null;
let loadRetries = 0;
let loadRetryTimer: ReturnType<typeof setTimeout> | undefined;

const resizeObserver = new ResizeObserver(() => minimap?.relayout());

function sync(): void {
  const discussion = isConversationTab(location.pathname)
    ? document.querySelector('.js-discussion')
    : null;
  if (!discussion) {
    teardown();
    return;
  }

  if (location.pathname !== currentPath) {
    teardown();
    currentPath = location.pathname;
  }
  if (!minimap) {
    void loadFonts();
    minimap = new Minimap({ onHiddenClick: (hidden) => loader.load(hidden.el) });
  }
  if (!minimap.isMounted) minimap.mount();
  if (observedRange !== discussion) {
    resizeObserver.disconnect();
    resizeObserver.observe(discussion);
    observedRange = discussion;
  }

  const events = filterEvents(extractEvents(document), {
    viewer: currentViewer(document),
    botsOnlyOnOwnPRs: SETTINGS.botsOnlyOnOwnPRs,
    hiddenBots: SETTINGS.hiddenBots,
  });
  minimap.setEntries(groupEntries(events), discussion);

  if (SETTINGS.autoLoadHidden) autoLoad(events.flatMap((e) => (e.kind === 'hidden' ? [e.el] : [])));
}

function autoLoad(forms: Element[]): void {
  const results = forms.map((form) => loader.load(form));
  // The page may be quiet by the time GitHub's script is ready, so don't wait for a DOM change.
  if (results.includes('not-ready') && !loadRetryTimer && loadRetries < MAX_LOAD_RETRIES) {
    loadRetries++;
    loadRetryTimer = setTimeout(() => {
      loadRetryTimer = undefined;
      sync();
    }, LOAD_RETRY_MS);
  }
}

function teardown(): void {
  minimap?.unmount();
  minimap = null;
  loader = new HiddenItemsLoader();
  currentPath = '';
  resizeObserver.disconnect();
  observedRange = null;
  clearTimeout(loadRetryTimer);
  loadRetryTimer = undefined;
  loadRetries = 0;
}

// Throttled rather than debounced: a page that never stops mutating would starve a debounce.
let syncTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleSync(): void {
  if (syncTimer !== undefined) return;
  syncTimer = setTimeout(() => {
    syncTimer = undefined;
    sync();
  }, SYNC_INTERVAL_MS);
}

let scrollFrame = 0;
function onScroll(): void {
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    minimap?.updateViewport();
  });
}

new MutationObserver((records) => {
  // Off the Conversation tab there's nothing to update, unless a timeline is still showing.
  if (!isConversationTab(location.pathname)) {
    if (minimap) scheduleSync();
    return;
  }
  if (location.pathname !== currentPath || affectsTimeline(records, observedRange)) scheduleSync();
}).observe(document.documentElement, {
  childList: true,
  subtree: true,
});
window.addEventListener('scroll', onScroll, { passive: true });
window.addEventListener('resize', () => minimap?.relayout());
window.addEventListener('popstate', scheduleSync);
sync();
