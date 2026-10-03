import { currentViewer, filterEvents } from '../src/filter';
import { groupEntries } from '../src/group';
import { SETTINGS } from '../src/settings';
import type { ReviewState, TimelineEvent } from '../src/types';

const el = () => document.createElement('div');
const description = (author: string): TimelineEvent => ({
  kind: 'description',
  el: el(),
  author,
  time: null,
  snippet: '',
});
const comment = (author: string, isBot = false): TimelineEvent => ({
  kind: 'comment',
  el: el(),
  author,
  time: null,
  isBot,
  snippet: '',
});
const review = (
  author: string,
  isBot = false,
  state: ReviewState = 'commented',
): TimelineEvent => ({
  kind: 'review',
  el: el(),
  author,
  time: null,
  isBot,
  state,
  snippet: '',
});
const commit = (title: string): TimelineEvent => ({
  kind: 'commit',
  el: el(),
  author: null,
  time: null,
  title,
});

const OPTS = {
  botsOnlyOnOwnPRs: ['coderabbitai'],
  hiddenBots: ['linear-code', 'blacksmith-sh'],
  approvalsOnlyBots: ['jbparabot'],
};
const who = (events: TimelineEvent[]) =>
  events.map((e) => `${e.kind}:${'author' in e ? e.author : ''}`);

describe('filterEvents', () => {
  const timeline = [
    description('amy'),
    comment('coderabbitai', true),
    review('coderabbitai', true),
    comment('dependabot', true),
    comment('bob'),
  ];

  // On someone else's PR, CodeRabbit's comments and reviews are noise: leave them out. Other bots
  // and people stay.
  it("leaves CodeRabbit out of someone else's PR", () => {
    expect(who(filterEvents(timeline, { ...OPTS, viewer: 'tim' }))).toEqual([
      'description:amy',
      'comment:dependabot',
      'comment:bob',
    ]);
  });

  // On your own PR, CodeRabbit is reviewing your code, so its comments stay.
  it('keeps CodeRabbit on your own PR', () => {
    expect(filterEvents(timeline, { ...OPTS, viewer: 'amy' })).toHaveLength(timeline.length);
  });

  // GitHub logins are case-insensitive.
  it('matches your login regardless of case', () => {
    expect(filterEvents(timeline, { ...OPTS, viewer: 'AMY' })).toHaveLength(timeline.length);
  });

  // Signed out, no PR is yours.
  it('leaves CodeRabbit out when signed out', () => {
    const kept = filterEvents(timeline, { ...OPTS, viewer: null });
    expect(who(kept)).not.toContain('comment:coderabbitai');
  });

  // Some bots are noise everywhere (Linear Code, Blacksmith CI): left out of every PR, even yours.
  it('leaves always-hidden bots out of every PR, including your own', () => {
    const events = [
      description('amy'),
      comment('linear-code', true),
      review('Blacksmith-SH', true),
      comment('coderabbitai', true),
    ];
    expect(who(filterEvents(events, { ...OPTS, viewer: 'amy' }))).toEqual([
      'description:amy',
      'comment:coderabbitai',
    ]);
    expect(who(filterEvents(events, { ...OPTS, viewer: 'tim' }))).toEqual(['description:amy']);
  });

  // Some bots only matter when they approve: their approvals show, and nothing else of theirs does.
  it('keeps only the approvals of approvals-only bots', () => {
    const approval = review('jbparabot', true, 'approved');
    const events = [
      description('amy'),
      comment('jbparabot', true),
      review('jbparabot', true, 'commented'),
      review('jbparabot', true, 'changes_requested'),
      approval,
    ];
    expect(filterEvents(events, { ...OPTS, viewer: 'amy' })).toEqual([events[0], approval]);
  });

  // The defaults asked for: GitHub Actions never shows, and jbparabot only shows its approvals.
  it('hides GitHub Actions, and all of jbparabot but its approvals, by default', () => {
    const events = [
      description('amy'),
      comment('github-actions', true),
      comment('jbparabot', true),
      review('jbparabot', true, 'approved'),
      comment('bob'),
    ];
    expect(who(filterEvents(events, { ...SETTINGS, viewer: 'amy' }))).toEqual([
      'description:amy',
      'review:jbparabot',
      'comment:bob',
    ]);
  });

  // Only bot accounts are matched, so a person with a similar name is never hidden.
  it('only hides bot accounts', () => {
    const person = comment('coderabbitai', false);
    expect(filterEvents([description('amy'), person], { ...OPTS, viewer: 'tim' })).toContain(
      person,
    );
  });

  // With a CodeRabbit comment gone, nothing separates the pushes either side of it, so they become
  // one row of changes.
  it('lets the pushes either side of a hidden comment merge into one row', () => {
    const events = [description('amy'), commit('a'), comment('coderabbitai', true), commit('b')];
    const entries = groupEntries(filterEvents(events, { ...OPTS, viewer: 'tim' }));
    expect(entries.map((e) => e.kind)).toEqual(['description', 'changes']);
  });
});

describe('currentViewer', () => {
  // GitHub names the signed-in user in a meta tag on every page.
  it('reads the signed-in login from the page', () => {
    const doc = new DOMParser().parseFromString(
      '<head><meta name="user-login" content="tkuminecz"></head>',
      'text/html',
    );
    expect(currentViewer(doc)).toBe('tkuminecz');
  });

  // Signed out, the tag is there but empty.
  it('is null when signed out', () => {
    const doc = new DOMParser().parseFromString(
      '<head><meta name="user-login" content=""></head>',
      'text/html',
    );
    expect(currentViewer(doc)).toBeNull();
  });
});
