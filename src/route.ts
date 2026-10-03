/** True on a PR's Conversation tab (`/owner/repo/pull/123`), false on its other tabs. */
export function isConversationTab(pathname: string): boolean {
  return /^\/[^/]+\/[^/]+\/pull\/\d+\/?$/.test(pathname);
}
