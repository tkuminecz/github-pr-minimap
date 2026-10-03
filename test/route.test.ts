import { isConversationTab } from '../src/route';

describe('isConversationTab', () => {
  // The minimap only belongs on the Conversation tab, which is the bare PR URL.
  it('matches the bare PR URL, with or without a trailing slash', () => {
    expect(isConversationTab('/cli/cli/pull/14519')).toBe(true);
    expect(isConversationTab('/cli/cli/pull/14519/')).toBe(true);
  });

  // Every other PR tab must make the minimap disappear.
  it('rejects the other PR tabs', () => {
    for (const tab of ['files', 'commits', 'checks', 'changes']) {
      expect(isConversationTab(`/cli/cli/pull/14519/${tab}`), tab).toBe(false);
    }
  });

  // Issues share the conversation layout but aren't PRs, and the PR list isn't a PR.
  it('rejects issues and the PR list', () => {
    expect(isConversationTab('/cli/cli/issues/14519')).toBe(false);
    expect(isConversationTab('/cli/cli/pulls')).toBe(false);
  });
});
