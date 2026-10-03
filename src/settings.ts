export interface Settings {
  /** Press GitHub's "Load more" automatically so the timeline covers the whole PR. */
  autoLoadHidden: boolean;
  /** Bots whose comments and reviews only show on PRs you opened (login names, any case). */
  botsOnlyOnOwnPRs: string[];
  /** Bots whose comments and reviews never show. */
  hiddenBots: string[];
}

export const SETTINGS: Settings = {
  autoLoadHidden: true,
  botsOnlyOnOwnPRs: ['coderabbitai'],
  hiddenBots: ['linear-code', 'blacksmith-sh'],
};
