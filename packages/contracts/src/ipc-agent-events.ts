// `isAgentEvent` is the one guard that reaches across every domain in this package: an agent event
// is a union over the payloads the other modules own. It imports their guards rather than restating
// their rules, which is what lets each guard live beside the type it validates.

import { type AgentProviderId, isAgentProvider } from "./agent-providers";
import { INPUT_LIMITS } from "./input-limits";
import { type AgentRuntimeSnapshot, isAgentRuntimeSnapshot } from "./ipc-agent-runtime";
import type { AccountUsage, AgentStatus } from "./ipc-agent-status";
import { type AgentTasksSnapshot, isAgentTasksSnapshot } from "./ipc-agent-tasks";
import { type AgentWaitsSnapshot, isAgentWaitsSnapshot } from "./ipc-agent-waits";
import { type ClientAgentSummary, isClientAgentSummary } from "./ipc-agents";
import {
  type AgentApproval,
  type BrowserTakeoverRequest,
  isAgentApproval,
  isBrowserTakeoverRequest,
} from "./ipc-approvals";
import { integerInRange, isBoundedString, isIdentifier } from "./ipc-bounded-values";
import type { BrowserControlState, BrowserTab } from "./ipc-browser";
import { type AgentPromptQuestion, isAgentPromptQuestion, isConversationMessage } from "./ipc-conversation-messages";
import {
  type ConversationPage,
  type ConversationSnapshot,
  isConversationReadState,
  isConversationSnapshot,
} from "./ipc-conversations";
import { type HiddenAgent, isHiddenAgentsSnapshot } from "./ipc-hidden-agents";
import { isQueueSnapshot, type QueueSnapshot } from "./ipc-queue";
import { isSidebarLayoutSnapshot, type SidebarLayoutSnapshot } from "./ipc-sidebar-layout";
import { isBoolean, isDynamicRecord, isNumber, isOneOf, isString } from "./runtime-values";

export type AgentTurnOrigin = "user" | "routine" | "agent" | "unknown";

function isAgentTurnOrigin(value: unknown): value is AgentTurnOrigin {
  return value === "user" || value === "routine" || value === "agent" || value === "unknown";
}

/** What a live turn step did: ran a command, changed files, worked with a subagent, or thought. */
export const TURN_STEP_KINDS = ["command", "file-change", "subagent", "thought"] as const;
export type TurnStepKind = (typeof TURN_STEP_KINDS)[number];

/** Whether the step still runs, or how it ended. */
export const TURN_STEP_STATUSES = ["running", "done", "failed"] as const;
export type TurnStepStatus = (typeof TURN_STEP_STATUSES)[number];

/** How one file changed: added, changed in place, or deleted. */
export const TURN_STEP_FILE_STATUSES = ["added", "modified", "deleted"] as const;
export type TurnStepFileStatus = (typeof TURN_STEP_FILE_STATUSES)[number];

/** One file that a step changed, with its added and removed line counts when known. */
export interface TurnStepFile {
  path: string;
  status: TurnStepFileStatus;
  additions?: number | undefined;
  deletions?: number | undefined;
  /** The unified diff of this step's change, built from the tool input. Local only, and redacted. */
  diff?: string | undefined;
}

export type AgentEvent =
  | { type: "channels-changed"; channelId: string; revision: number }
  | { type: "status"; status: AgentStatus }
  | { type: "usage-changed"; usage: AccountUsage }
  | { type: "agents-changed"; agents: ClientAgentSummary[] }
  | { type: "memories-changed"; agentId: string }
  | { type: "routines-changed"; agentId: string }
  | { type: "skills-changed"; agentId: string }
  /** The routine canvas of this agent changed, so the views showing it read it again. */
  | { type: "routine-flows-changed"; agentId: string }
  | { type: "agent-session-settings-changed"; agentId: string }
  | { type: "channel-memories-changed"; channelId: string }
  | { type: "channel-routines-changed"; channelId: string }
  | { type: "sidebar-layout-changed"; layout: SidebarLayoutSnapshot }
  /** The whole hidden list, in the `agent-hidden-v1` wire shape, so the Team API sends it as it is. */
  | { type: "hidden-agents-changed"; agents: HiddenAgent[] }
  /** The roles changed. A client reads `/v1/agent-access` again for its own levels. */
  | { type: "agent-access-changed"; revision: number }
  | { type: "conversation"; snapshot: ConversationSnapshot }
  | { type: "conversation-invalidated"; agentId: string; revision: number }
  | { type: "conversation-page"; page: ConversationPage }
  | {
      type: "conversation-delta";
      agentId: string;
      threadId: string;
      turnId: string;
      messageId: string;
      delta: string;
      createdAt: string;
      revision: number;
    }
  | { type: "queue-invalidated"; agentId: string }
  | { type: "queue-changed"; snapshot: QueueSnapshot }
  /** Local only: the Team API has no wait events, so a remote server never sends one. */
  | { type: "waits-changed"; snapshot: AgentWaitsSnapshot }
  /** The Team API sends the three task events below only to a peer with `agent-tasks-v1`, in this shape. */
  | { type: "agent-tasks-changed"; snapshot: AgentTasksSnapshot }
  /** The conversation of one task. Its turns never reach the agent's own chat events. */
  | { type: "agent-task-conversation"; taskId: string; snapshot: ConversationSnapshot }
  | {
      type: "agent-task-conversation-delta";
      taskId: string;
      agentId: string;
      threadId: string;
      turnId: string;
      messageId: string;
      delta: string;
      createdAt: string;
      revision: number;
    }
  | { type: "turn-progress"; agentId: string; threadId: string; turnId: string; detail: string }
  /**
   * One step of a running turn, as it starts and as it ends. The chat shows each step live and
   * keeps the files for the Changes panel. Local only: the Team API event projection drops it,
   * and no adapter carries it.
   */
  | {
      type: "turn-step";
      agentId: string;
      threadId: string;
      turnId: string;
      stepId: string;
      kind: TurnStepKind;
      status: TurnStepStatus;
      /** The row text, in the host's English source words. */
      text: string;
      /** On a command step: the command, with known secrets removed. */
      command?: string | undefined;
      /** On a command step that ended: its exit code when known. */
      exitCode?: number | undefined;
      /** On a file-change step: the files it changed, up to the per-step limit. */
      files?: TurnStepFile[] | undefined;
      startedAt: string;
      /** Absent while the step runs. */
      endedAt?: string | undefined;
    }
  | { type: "turn-started"; agentId: string; threadId: string; turnId: string; origin?: AgentTurnOrigin }
  | {
      type: "turn-completed";
      agentId: string;
      threadId: string;
      turnId: string;
      status: string;
      /** Why a failed turn failed, redacted and short. Absent when the provider gave no reason. */
      error?: string;
      origin?: AgentTurnOrigin;
      /**
       * A routine run that had nothing to report and posted no message. It is not news, so it shows
       * no notification. The Team API carries it through the optional `quiet-turn-v1` capability.
       * Peers without that capability receive the released completion event.
       */
      quiet?: true;
    }
  | {
      type: "prompt";
      requestId: string | number;
      agentId: string;
      threadId: string;
      turnId: string;
      questions: AgentPromptQuestion[];
    }
  | {
      type: "agent-input-resolved";
      kind: "prompt" | "approval";
      requestId: string | number;
      agentId: string;
    }
  | { type: "browser-takeover-requested"; request: BrowserTakeoverRequest }
  | { type: "browser-takeover-resolved"; requestId: string | number; agentId: string }
  | { type: "approval"; approval: AgentApproval }
  | { type: "runtime-snapshot"; snapshot: AgentRuntimeSnapshot }
  | { type: "browser-changed"; tabs: BrowserTab[]; activeTabId: string | null }
  | { type: "browser-control-changed"; state: BrowserControlState }
  /** The whole list of tabs that a person controls, in the `browser-user-control` wire shape. */
  | { type: "browser-user-control-changed"; tabIds: string[] }
  /** The history state of every tab, in the `browser-page-state` wire shape. */
  | {
      type: "browser-page-state-changed";
      tabs: { tabId: string; canGoBack: boolean; canGoForward: boolean }[];
    }
  /**
   * `provider` and `model` name the run that failed, for the banner. Local only: the Team API event
   * projection drops them.
   */
  | { type: "error"; agentId?: string; code: string; message: string; provider?: AgentProviderId; model?: string }
  /**
   * A provider plan refused a turn, once per limit. The queues of its agents wait for the reset.
   * Local only: the released Team API event adapters do not carry it. `resetsAt` is in epoch seconds.
   */
  | {
      type: "usage-limit-reached";
      agentId: string;
      provider: AgentProviderId;
      resetsAt: number | null;
      agentCount: number;
    };

const TURN_STEP_TIME_LIMIT = 160;

function isTurnStepFile(value: unknown): value is TurnStepFile {
  return (
    isDynamicRecord(value) &&
    isBoundedString(value.path, INPUT_LIMITS.path) &&
    value.path.length > 0 &&
    isOneOf(TURN_STEP_FILE_STATUSES, value.status) &&
    (value.additions === undefined || integerInRange(value.additions, 0, Number.MAX_SAFE_INTEGER)) &&
    (value.deletions === undefined || integerInRange(value.deletions, 0, Number.MAX_SAFE_INTEGER)) &&
    (value.diff === undefined || isBoundedString(value.diff, INPUT_LIMITS.turnStepDiff))
  );
}

export function isAgentEvent(value: unknown): value is AgentEvent {
  if (!isDynamicRecord(value) || !isString(value.type)) return false;
  switch (value.type) {
    case "channels-changed":
      return (
        isIdentifier(value.channelId) &&
        typeof value.revision === "number" &&
        Number.isSafeInteger(value.revision) &&
        value.revision >= 0
      );
    case "status":
      return isDynamicRecord(value.status);
    case "usage-changed":
      return isDynamicRecord(value.usage);
    case "agents-changed":
      return (
        Array.isArray(value.agents) &&
        value.agents.length <= INPUT_LIMITS.agents &&
        value.agents.every(isClientAgentSummary)
      );
    case "memories-changed":
      return isString(value.agentId) && value.agentId.length > 0 && value.agentId.length <= INPUT_LIMITS.identifier;
    case "routines-changed":
      return isString(value.agentId) && value.agentId.length > 0 && value.agentId.length <= INPUT_LIMITS.identifier;
    case "agent-session-settings-changed":
    case "skills-changed":
    case "routine-flows-changed":
      return isIdentifier(value.agentId);
    case "channel-memories-changed":
    case "channel-routines-changed":
      return isIdentifier(value.channelId);
    case "sidebar-layout-changed":
      return isSidebarLayoutSnapshot(value.layout);
    case "hidden-agents-changed":
      return isHiddenAgentsSnapshot({ agents: value.agents });
    case "agent-access-changed":
      return isNumber(value.revision) && Number.isSafeInteger(value.revision) && value.revision >= 0;
    case "conversation":
      return isConversationSnapshot(value.snapshot);
    case "conversation-invalidated":
      return (
        isIdentifier(value.agentId) &&
        isNumber(value.revision) &&
        Number.isInteger(value.revision) &&
        value.revision >= 0
      );
    case "conversation-page": {
      const page = value.page;
      if (!isDynamicRecord(page)) return false;
      const references = page.references;
      const pageInfo = page.pageInfo;
      const readState = page.readState;
      return (
        isConversationSnapshot(page) &&
        page.messages.length <= 100 &&
        isDynamicRecord(references) &&
        Object.values(references).every(isConversationMessage) &&
        isDynamicRecord(pageInfo) &&
        isBoolean(pageInfo.hasOlder) &&
        (pageInfo.olderCursor === null || isString(pageInfo.olderCursor)) &&
        (readState === undefined || isConversationReadState(readState))
      );
    }
    case "conversation-delta":
      return (
        isString(value.agentId) &&
        isString(value.threadId) &&
        isString(value.turnId) &&
        isString(value.messageId) &&
        isString(value.delta) &&
        isString(value.createdAt) &&
        isNumber(value.revision)
      );
    case "queue-invalidated":
      return isIdentifier(value.agentId);
    case "queue-changed":
      return isQueueSnapshot(value.snapshot);
    case "waits-changed":
      return isAgentWaitsSnapshot(value.snapshot);
    case "agent-tasks-changed":
      return isAgentTasksSnapshot(value.snapshot);
    case "agent-task-conversation":
      return isIdentifier(value.taskId) && isConversationSnapshot(value.snapshot);
    case "agent-task-conversation-delta":
      return (
        isIdentifier(value.taskId) &&
        isString(value.agentId) &&
        isString(value.threadId) &&
        isString(value.turnId) &&
        isString(value.messageId) &&
        isString(value.delta) &&
        isString(value.createdAt) &&
        isNumber(value.revision)
      );
    case "turn-progress":
      return (
        isIdentifier(value.agentId) &&
        isIdentifier(value.threadId) &&
        isIdentifier(value.turnId) &&
        isString(value.detail) &&
        value.detail.length > 0 &&
        value.detail.length <= INPUT_LIMITS.promptQuestion
      );
    case "turn-step":
      return (
        isIdentifier(value.agentId) &&
        isIdentifier(value.threadId) &&
        isIdentifier(value.turnId) &&
        isIdentifier(value.stepId) &&
        isOneOf(TURN_STEP_KINDS, value.kind) &&
        isOneOf(TURN_STEP_STATUSES, value.status) &&
        isBoundedString(value.text, INPUT_LIMITS.turnStepText) &&
        value.text.length > 0 &&
        (value.command === undefined || isBoundedString(value.command, INPUT_LIMITS.turnStepCommand)) &&
        (value.exitCode === undefined || (isNumber(value.exitCode) && Number.isSafeInteger(value.exitCode))) &&
        (value.files === undefined ||
          (Array.isArray(value.files) &&
            value.files.length <= INPUT_LIMITS.turnStepFiles &&
            value.files.every(isTurnStepFile))) &&
        isBoundedString(value.startedAt, TURN_STEP_TIME_LIMIT) &&
        (value.endedAt === undefined || isBoundedString(value.endedAt, TURN_STEP_TIME_LIMIT))
      );
    case "turn-started":
    case "turn-completed":
      return (
        isString(value.agentId) &&
        isString(value.threadId) &&
        isString(value.turnId) &&
        (value.origin === undefined || isAgentTurnOrigin(value.origin)) &&
        (value.error === undefined || isString(value.error)) &&
        (value.quiet === undefined || value.quiet === true)
      );
    case "prompt":
      return (
        (isString(value.requestId) || isNumber(value.requestId)) &&
        isString(value.agentId) &&
        isString(value.threadId) &&
        isString(value.turnId) &&
        Array.isArray(value.questions) &&
        value.questions.length <= INPUT_LIMITS.promptQuestions &&
        value.questions.every(isAgentPromptQuestion)
      );
    case "agent-input-resolved":
      return (
        (value.kind === "prompt" || value.kind === "approval") &&
        (isString(value.requestId) || isNumber(value.requestId)) &&
        isString(value.agentId)
      );
    case "browser-takeover-requested":
      return isBrowserTakeoverRequest(value.request);
    case "browser-takeover-resolved":
      return (isString(value.requestId) || isNumber(value.requestId)) && isString(value.agentId);
    case "approval":
      return isAgentApproval(value.approval);
    case "runtime-snapshot":
      return isAgentRuntimeSnapshot(value.snapshot);
    case "browser-changed":
      return Array.isArray(value.tabs) && (value.activeTabId === null || isString(value.activeTabId));
    case "browser-control-changed":
      return isDynamicRecord(value.state);
    case "browser-user-control-changed":
      return Array.isArray(value.tabIds) && value.tabIds.every(isString);
    case "browser-page-state-changed":
      return (
        Array.isArray(value.tabs) &&
        value.tabs.every(
          (tab) =>
            isDynamicRecord(tab) && isString(tab.tabId) && isBoolean(tab.canGoBack) && isBoolean(tab.canGoForward),
        )
      );
    case "error":
      return (
        isString(value.code) &&
        isString(value.message) &&
        (value.provider === undefined || isAgentProvider(value.provider)) &&
        (value.model === undefined || isString(value.model))
      );
    case "usage-limit-reached":
      return (
        isIdentifier(value.agentId) &&
        isAgentProvider(value.provider) &&
        (value.resetsAt === null || (isNumber(value.resetsAt) && Number.isFinite(value.resetsAt))) &&
        isNumber(value.agentCount) &&
        Number.isSafeInteger(value.agentCount) &&
        value.agentCount >= 0
      );
    default:
      return false;
  }
}

export interface ScopedAgentEvent {
  serverId: string;
  event: AgentEvent;
  bufferedLive?: boolean;
}

export interface AgentIpcRequest<T = unknown> {
  serverId: string;
  payload: T;
}
