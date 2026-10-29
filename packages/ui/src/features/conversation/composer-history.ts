/*
 * Arrow Up and Down in the composer step through the messages the user sent in this conversation,
 * as a shell recalls its commands. The first Up keeps the draft and shows the newest message; Up
 * stops at the oldest. Down walks back toward the newest, and Down past it brings the draft back.
 */

/** Where the composer is in its history. `index` is null while it shows the user's own draft. */
export interface ComposerHistoryState {
  index: number | null;
  /** The draft that the first Up put aside, restored by Down past the newest message. */
  draft: string;
}

export type ComposerHistoryDirection = "older" | "newer";

export interface ComposerHistoryStep {
  state: ComposerHistoryState;
  value: string;
}

export function idleComposerHistory(): ComposerHistoryState {
  return { index: null, draft: "" };
}

/**
 * The sent texts, oldest first, that Arrow Up offers. Blank texts are left out, and a message sent
 * twice in a row is offered once.
 */
export function composerSentHistory(texts: readonly string[]): string[] {
  const history: string[] = [];
  for (const text of texts) {
    if (!text.trim() || history.at(-1) === text) continue;
    history.push(text);
  }
  return history;
}

/**
 * One Arrow Up ("older") or Arrow Down ("newer"). Returns null when the key is not the history's:
 * there is nothing sent, or Down while the composer shows the draft. At the oldest message Up keeps
 * showing it.
 */
export function stepComposerHistory(
  sent: readonly string[],
  state: ComposerHistoryState,
  direction: ComposerHistoryDirection,
  currentValue: string,
): ComposerHistoryStep | null {
  const newest = sent.length - 1;
  if (newest < 0) return null;
  if (state.index === null) {
    if (direction === "newer") return null;
    return { state: { index: newest, draft: currentValue }, value: sent[newest] ?? "" };
  }
  // The list can shrink under an open history, for example when a message is deleted.
  const current = Math.min(state.index, newest);
  if (direction === "older") {
    const index = Math.max(current - 1, 0);
    return { state: { index, draft: state.draft }, value: sent[index] ?? "" };
  }
  if (current >= newest) return { state: idleComposerHistory(), value: state.draft };
  const index = current + 1;
  return { state: { index, draft: state.draft }, value: sent[index] ?? "" };
}
