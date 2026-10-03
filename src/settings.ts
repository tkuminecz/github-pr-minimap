export interface Settings {
  /** Press GitHub's "Load more" automatically so the timeline covers the whole PR. */
  autoLoadHidden: boolean;
  /** Bots whose comments and reviews only show on PRs you opened (login names, any case). */
  botsOnlyOnOwnPRs: string[];
  /** Bots whose comments and reviews never show. */
  hiddenBots: string[];
  /** Bots whose approvals show, but none of their comments or other reviews. */
  approvalsOnlyBots: string[];
}

export const SETTINGS: Settings = {
  autoLoadHidden: true,
  botsOnlyOnOwnPRs: ['coderabbitai'],
  hiddenBots: ['linear-code', 'blacksmith-sh', 'github-actions'],
  approvalsOnlyBots: ['jbparabot'],
};
