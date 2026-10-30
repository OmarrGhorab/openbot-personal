import type { TurnStepFile, TurnStepKind, TurnStepStatus } from "@openbot/contracts/ipc";

/**
 * One live step of a running turn, as the host sent it in `turn-step` events, in the order it
 * changed. The host sends each step twice - running, then done or failed - so a window keeps the
 * newest state of each step in memory for its newest turns. After a restart a turn shows only its
 * stored trace, which the chat rebuilds the same rows from.
 */
export interface TurnLiveStep {
  /** The provider's item id, unique in the turn. */
  id: string;
  kind: TurnStepKind;
  status: TurnStepStatus;
  /** The row text, in the host's English source words. */
  text: string;
  /** On a command step: the redacted command. */
  command?: string | undefined;
  /** On a command step that ended: its exit code when known. */
  exitCode?: number | undefined;
  /** On a file-change step: the files it changed. */
  files?: TurnStepFile[] | undefined;
  /** When this window got the newest state of the step, to place it between the turn's thoughts. */
  at: number;
}

export type TurnLiveSteps = Readonly<Record<string, readonly TurnLiveStep[]>>;

const TURN_LIMIT = 50;
const STEP_LIMIT = 200;

/** `steps` with `step` added or replaced in the turn, capped like the progress lines. */
export function upsertTurnLiveSteps(
  steps: TurnLiveSteps,
  turnId: string,
  step: TurnLiveStep,
): TurnLiveSteps {
  const turn = (steps[turnId] ?? []).filter((candidate) => candidate.id !== step.id);
  // The turn moves to the end, so the limit drops the turns that got no step for the longest time,
  // and not a long turn that started first.
  const next: Record<string, readonly TurnLiveStep[]> = { ...steps };
  delete next[turnId];
  next[turnId] = [...turn, step].slice(-STEP_LIMIT);
  const turns = Object.keys(next);
  for (const old of turns.slice(0, Math.max(0, turns.length - TURN_LIMIT))) delete next[old];
  return next;
}
