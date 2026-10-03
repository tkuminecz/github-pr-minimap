export type ReviewState = 'approved' | 'changes_requested' | 'commented';

export type Milestone = 'merged' | 'closed' | 'reopened' | 'ready_for_review' | 'draft';

/** Fields every event shares. `el` is the page element the event's marker points at. */
interface EventBase {
  el: Element;
  author: string | null;
  /** ISO 8601 timestamp, when the page shows one. */
  time: string | null;
}

export interface DescriptionEvent extends EventBase {
  kind: 'description';
  snippet: string;
}

export interface CommentEvent extends EventBase {
  kind: 'comment';
  isBot: boolean;
  snippet: string;
}

export interface ReviewEvent extends EventBase {
  kind: 'review';
  isBot: boolean;
  state: ReviewState;
  snippet: string;
}

export interface CommitEvent extends EventBase {
  kind: 'commit';
  title: string;
}

export interface ForcePushEvent extends EventBase {
  kind: 'force_push';
}

export interface MilestoneEvent extends EventBase {
  kind: 'milestone';
  milestone: Milestone;
}

/** GitHub's "N hidden items / Load more…" placeholder on long PRs. */
export interface HiddenEvent extends EventBase {
  kind: 'hidden';
  count: number;
}

export type TimelineEvent =
  | DescriptionEvent
  | CommentEvent
  | ReviewEvent
  | CommitEvent
  | ForcePushEvent
  | MilestoneEvent
  | HiddenEvent;

/**
 * Back-to-back pushes (commits and force-pushes with no comment, review or milestone between them),
 * shown as one row. `el` is the first push's element.
 */
export interface ChangesGroup {
  kind: 'changes';
  el: Element;
  commits: CommitEvent[];
  forcePushes: ForcePushEvent[];
  /** Latest timestamp among the pushes. GitHub shows times on force-pushes but not on commits. */
  time: string | null;
}

/** One row on the minimap. */
export type Entry = Exclude<TimelineEvent, CommitEvent | ForcePushEvent> | ChangesGroup;

/** A vertical span in page (document) coordinates, in px. */
export interface Span {
  top: number;
  bottom: number;
}
