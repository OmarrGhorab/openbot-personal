import { INPUT_LIMITS } from "./input-limits";
import { isDynamicRecord, isOneOf, isString } from "./runtime-values";

/**
 * Facts about one project folder. Every agent whose workspace is that folder shares them, and so does
 * each of its work threads. An agent's own memories (`ipc-agent-memories.ts`) stay private to it.
 */
export const PROJECT_MEMORY_KINDS = ["rule", "command", "known-problem", "decision"] as const;
export type ProjectMemoryKind = (typeof PROJECT_MEMORY_KINDS)[number];

/** Entries one project can hold. A new entry past it is refused; no entry is removed to make room. */
export const PROJECT_MEMORY_LIMIT = 128;

/** The byte budget of the project block that a work thread reads at its start. */
export const PROJECT_MEMORY_CONTEXT_BUDGET_BYTES = 4096;

export interface ProjectMemory {
  id: string;
  kind: ProjectMemoryKind;
  text: string;
  /** Null when the OpenBot user saved the entry. */
  savedByAgentId: string | null;
  /** Null when the OpenBot user last edited the entry. */
  updatedByAgentId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The last change to a project's memory. Only this one change can be undone. */
export interface ProjectMemoryUndo {
  action: "create" | "update" | "delete";
  memoryId: string;
  changedByAgentId: string | null;
  changedAt: string;
}

export interface ProjectMemoryState {
  /** The project folder: the workspace path of the agent that the request names. */
  projectPath: string;
  memories: ProjectMemory[];
  limit: number;
  undo: ProjectMemoryUndo | null;
}

export interface ProjectMemoryAgentInput {
  agentId: string;
}

export interface CreateProjectMemoryInput {
  agentId: string;
  kind: ProjectMemoryKind;
  text: string;
}

export interface UpdateProjectMemoryInput extends CreateProjectMemoryInput {
  memoryId: string;
}

export interface DeleteProjectMemoryInput {
  agentId: string;
  memoryId: string;
}

export function isProjectMemory(value: unknown): value is ProjectMemory {
  return (
    isDynamicRecord(value) &&
    isString(value.id) &&
    value.id.length > 0 &&
    value.id.length <= INPUT_LIMITS.identifier &&
    isOneOf(PROJECT_MEMORY_KINDS, value.kind) &&
    isString(value.text) &&
    value.text.length > 0 &&
    value.text.length <= INPUT_LIMITS.agentMemoryText &&
    (value.savedByAgentId === null || isString(value.savedByAgentId)) &&
    (value.updatedByAgentId === null || isString(value.updatedByAgentId)) &&
    isString(value.createdAt) &&
    isString(value.updatedAt)
  );
}

export function isProjectMemoryUndo(value: unknown): value is ProjectMemoryUndo {
  return (
    isDynamicRecord(value) &&
    isOneOf(["create", "update", "delete"] as const, value.action) &&
    isString(value.memoryId) &&
    (value.changedByAgentId === null || isString(value.changedByAgentId)) &&
    isString(value.changedAt)
  );
}

export function isProjectMemoryState(value: unknown): value is ProjectMemoryState {
  return (
    isDynamicRecord(value) &&
    isString(value.projectPath) &&
    Array.isArray(value.memories) &&
    value.memories.every(isProjectMemory) &&
    typeof value.limit === "number" &&
    (value.undo === null || isProjectMemoryUndo(value.undo))
  );
}
