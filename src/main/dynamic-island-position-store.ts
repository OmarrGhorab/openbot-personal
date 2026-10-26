// Where each display's Dynamic Island window sits. The window moves only when the user drags it,
// so this small file is written on each drag end and read once at startup. A position that no
// longer fits its display, because the resolution changed, is clamped by the window controller.

import {
  DYNAMIC_ISLAND_POSITION_LIMIT,
  type DynamicIslandWindowPosition,
  isDynamicIslandWindowPosition,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

/** The most displays whose position is saved. A computer has far fewer. */
const POSITION_LIMIT = 32;

export type DynamicIslandPositions = ReadonlyMap<number, DynamicIslandWindowPosition>;

const NO_POSITIONS: DynamicIslandPositions = new Map();

export const readDynamicIslandPositions = Effect.fn("readDynamicIslandPositions")((path: string) =>
  readPreferenceFile(path, (parsed): DynamicIslandPositions => {
    if (!isDynamicRecord(parsed) || parsed.version !== 1 || !isDynamicRecord(parsed.positions)) {
      return new Map(NO_POSITIONS);
    }
    const positions = new Map<number, DynamicIslandWindowPosition>();
    for (const [key, value] of Object.entries(parsed.positions)) {
      if (positions.size >= POSITION_LIMIT) break;
      const displayId = Number(key);
      if (!Number.isSafeInteger(displayId) || displayId < 0) continue;
      if (!isDynamicIslandWindowPosition(value)) continue;
      if (Math.abs(value.x) > DYNAMIC_ISLAND_POSITION_LIMIT || Math.abs(value.y) > DYNAMIC_ISLAND_POSITION_LIMIT)
        continue;
      positions.set(displayId, { x: value.x, y: value.y });
    }
    return positions;
  }).pipe(
    Effect.catch((failure) => {
      const error = failure.cause;
      if (isMissingFileError(error) || error instanceof SyntaxError) return Effect.succeed(new Map(NO_POSITIONS));
      return Effect.fail(failure);
    }),
  ),
);

export function writeDynamicIslandPositions(
  path: string,
  positions: DynamicIslandPositions,
): Effect.Effect<void, PreferenceFileFailure> {
  const values = Object.fromEntries([...positions].map(([displayId, position]) => [String(displayId), position]));
  return writePreferenceFile(path, { version: 1, positions: values });
}
