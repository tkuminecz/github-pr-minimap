/**
 * Whether a batch of page changes could change the timeline. GitHub changes its page constantly
 * (hover cards, header, presence indicators); only changes inside the conversation matter. With no
 * conversation on the page yet, or after GitHub replaced it, any change might be it arriving.
 */
export function affectsTimeline(records: MutationRecord[], discussion: Element | null): boolean {
  if (!discussion?.isConnected) return true;
  return records.some((record) => discussion.contains(record.target));
}
