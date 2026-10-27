/** The part of a scroll container that sets where a chat opens. */
export type ChatScrollBox = Pick<HTMLElement, "scrollTop" | "scrollHeight" | "clientHeight">;

/** The chats to keep a place for. An older place goes first. */
const KEPT_PLACES = 100;

/**
 * The place of each chat that the reader scrolled away from the newest message, by `server:agent`.
 * The place is the distance from the bottom, so a page of older messages that loads above does not
 * move it. A chat with no place opens at the newest message.
 */
export function createChatScrollMemory(limit = KEPT_PLACES) {
  const places = new Map<string, number>();
  return {
    /** Keep the reader's place when the reader holds the chat above the bottom, or forget it. */
    remember(identity: string | undefined, element: ChatScrollBox, readerHolds: boolean): void {
      if (!identity) return;
      places.delete(identity);
      if (!readerHolds) return;
      places.set(identity, Math.max(0, element.scrollHeight - element.clientHeight - element.scrollTop));
      const oldest = places.keys().next();
      if (places.size > limit && !oldest.done) places.delete(oldest.value);
    },
    /** The distance from the bottom where this chat opens again. Undefined opens at the newest message. */
    place(identity: string): number | undefined {
      return places.get(identity);
    },
    forget(identity: string): void {
      places.delete(identity);
    },
  };
}

/**
 * Where a chat opens: at the newest message, or at the reader's kept place. Set this before the first
 * paint of the rows, so the chat never shows its oldest messages first.
 */
export function openChatAt(element: ChatScrollBox, distanceFromBottom = 0): void {
  const bottom = Math.max(0, element.scrollHeight - element.clientHeight);
  element.scrollTop = Math.max(0, bottom - distanceFromBottom);
}

/** One memory for all views: a chat view can mount again for the same chat. */
export const chatScrollMemory = createChatScrollMemory();
