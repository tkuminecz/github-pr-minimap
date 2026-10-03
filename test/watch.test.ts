import { affectsTimeline } from '../src/watch';

/** A page with a header and a conversation, plus a fake mutation record for any element. */
function page() {
  document.body.innerHTML = `
    <header><span class="hovercard"></span></header>
    <div class="js-discussion"><div class="js-timeline-item"><p>hi</p></div></div>`;
  const discussion = document.querySelector('.js-discussion') as Element;
  const at = (selector: string) =>
    ({ target: document.querySelector(selector) }) as unknown as MutationRecord;
  return { discussion, at };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('affectsTimeline', () => {
  // New comments, loaded hidden items and edits all land inside the conversation: re-read it.
  it('counts changes inside the conversation', () => {
    const { discussion, at } = page();
    expect(affectsTimeline([at('.js-timeline-item p')], discussion)).toBe(true);
    expect(affectsTimeline([at('.js-discussion')], discussion)).toBe(true);
  });

  // GitHub changes its page constantly (hover cards, header, presence). Re-reading the timeline for
  // each of those was wasted work.
  it('ignores changes elsewhere on the page', () => {
    const { discussion, at } = page();
    expect(affectsTimeline([at('header'), at('.hovercard'), at('body')], discussion)).toBe(false);
  });

  // Before the conversation has loaded, or after GitHub replaced it, any change might be the new
  // one arriving.
  it('counts any change while there is no conversation to watch', () => {
    const { discussion, at } = page();
    expect(affectsTimeline([at('header')], null)).toBe(true);
    discussion.remove();
    expect(affectsTimeline([at('header')], discussion)).toBe(true);
  });
});
