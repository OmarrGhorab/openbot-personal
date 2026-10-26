// The Monitor of a channel on this computer. It reads the local sources (the channel page, the
// agents and their tasks, and the mailbox), keeps the live turns from the agent events, and builds
// one snapshot with `buildMonitorSnapshot`. Tool-call text and errors are redacted here, before a
// snapshot leaves main. It sends a change for a channel only after a window read that channel.

import type {
  AgentEvent,
  AgentTask,
  ChannelPage,
  ConversationMessage,
  MonitorAgentAttention,
  MonitorAgentSource,
  MonitorChange,
  MonitorExchange,
  MonitorLiveTurn,
  MonitorSnapshot,
} from "@openbot/contracts/ipc";
import {
  buildMonitorSnapshot,
  MONITOR_ERROR_LIMIT,
  MONITOR_TOOL_ARGUMENT_LIMIT,
  MONITOR_TOOL_TEXT_LIMIT,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { redactText } from "@openbot/logging";
import { Context, Effect, Schema } from "effect";
import { causeHelpers } from "../backend/effect-boundary";

/** The channel is not on this computer, or it was deleted. */
export class MonitorChannelMissing extends Schema.TaggedError<MonitorChannelMissing>()("MonitorChannelMissing", {
  cause: Schema.Defect(),
}) {}

/** A local source could not be read. The cause stays private. */
export class MonitorSourceFailed extends Schema.TaggedError<MonitorSourceFailed>()("MonitorSourceFailed", {
  cause: Schema.Defect(),
}) {}

const { sync: readSource } = causeHelpers(MonitorSourceFailed);

/** What the Monitor reads on this computer. `AgentService` and `MailboxStore` supply it in the app. */
export interface MonitorLocalSources {
  /** Throws when the channel does not exist. */
  channelPage(channelId: string): ChannelPage;
  agents(): MonitorAgentSource[];
  agentTasks(agentId: string): AgentTask[];
  taskMessages(agentId: string, taskId: string): ConversationMessage[];
  channelExchanges(channelId: string): MonitorExchange[];
  /** The channel whose member thread this is, or null. */
  channelForThread(threadId: string): string | null;
}

export class MonitorDataSource extends Context.Service<
  MonitorDataSource,
  {
    channelPage(channelId: string): Effect.Effect<ChannelPage, MonitorChannelMissing>;
    agents(): Effect.Effect<MonitorAgentSource[], MonitorSourceFailed>;
    agentTasks(agentId: string): Effect.Effect<AgentTask[], MonitorSourceFailed>;
    taskMessages(agentId: string, taskId: string): Effect.Effect<ConversationMessage[], MonitorSourceFailed>;
    channelExchanges(channelId: string): Effect.Effect<MonitorExchange[], MonitorSourceFailed>;
  }
>()("openbot/main/MonitorDataSource") {
  static make(sources: MonitorLocalSources) {
    return MonitorDataSource.of({
      channelPage: (channelId) =>
        Effect.try({
          try: () => sources.channelPage(channelId),
          catch: () => new MonitorChannelMissing({ cause: new Error(sourceText("error.backend.monitorChannelMissing")) }),
        }),
      agents: () => readSource(() => sources.agents()),
      agentTasks: (agentId) => readSource(() => sources.agentTasks(agentId)),
      taskMessages: (agentId, taskId) => readSource(() => sources.taskMessages(agentId, taskId)),
      channelExchanges: (channelId) => readSource(() => sources.channelExchanges(channelId)),
    });
  }
}

/** The steps of one live turn that a snapshot keeps. Older steps are in the turn's trace when it ends. */
const LIVE_STEP_LIMIT = 50;
/** Changes that arrive within this time reach the window as one. A streaming reply sends many events. */
const CHANGE_COALESCE_MS = 200;

const bounded = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text);

/**
 * Removes secrets from every tool-call text and error of a snapshot. The redaction marker can make
 * a text longer, so each text is cut to its bound again after it.
 */
export function redactMonitorSnapshot(
  snapshot: MonitorSnapshot,
  redact: (text: string) => string = redactText,
): MonitorSnapshot {
  const nullable = (text: string | null, limit: number) => (text === null ? null : bounded(redact(text), limit));
  return {
    ...snapshot,
    agents: snapshot.agents.map((agent) => ({ ...agent, error: nullable(agent.error, MONITOR_ERROR_LIMIT) })),
    tasks: snapshot.tasks.map((task) => ({ ...task, error: nullable(task.error, MONITOR_ERROR_LIMIT) })),
    toolCalls: snapshot.toolCalls.map((call) => ({
      ...call,
      argument: bounded(redact(call.argument), MONITOR_TOOL_ARGUMENT_LIMIT),
      input: nullable(call.input, MONITOR_TOOL_TEXT_LIMIT),
      output: nullable(call.output, MONITOR_TOOL_TEXT_LIMIT),
    })),
  };
}

interface LiveTurn extends MonitorLiveTurn {
  threadId: string;
  /** The channel of a member thread. Null for an agent task or the agent's own chat. */
  channelId: string | null;
}

export interface MonitorServiceOptions {
  sources: MonitorLocalSources;
  /** Sends a change to the windows. */
  onChange: (change: MonitorChange) => void;
  now?: () => Date;
  redact?: (text: string) => string;
}

export class MonitorService {
  readonly #sources: MonitorLocalSources;
  readonly #dataSource: typeof MonitorDataSource.Service;
  readonly #onChange: (change: MonitorChange) => void;
  readonly #now: () => Date;
  readonly #redact: (text: string) => string;
  /** The turns that run now, by turn id. */
  readonly #liveTurns = new Map<string, LiveTurn>();
  /** The newest prompt, approval or error of each agent. */
  readonly #attention = new Map<string, MonitorAgentAttention>();
  /** The channels a window read, with their members at that read, and their revision. */
  readonly #watched = new Map<string, { members: Set<string>; revision: number }>();
  readonly #pending = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(options: MonitorServiceOptions) {
    this.#sources = options.sources;
    this.#dataSource = MonitorDataSource.make(options.sources);
    this.#onChange = options.onChange;
    this.#now = options.now ?? (() => new Date());
    this.#redact = options.redact ?? redactText;
  }

  /** The snapshot of one channel, redacted. Reading it also starts its change events. */
  snapshot(channelId: string): Effect.Effect<MonitorSnapshot, MonitorChannelMissing | MonitorSourceFailed> {
    return this.#build(channelId).pipe(Effect.provideService(MonitorDataSource, this.#dataSource));
  }

  readonly #build = Effect.fn("MonitorService.snapshot")(function* (this: MonitorService, channelId: string) {
    const data = yield* MonitorDataSource;
    const page = yield* data.channelPage(channelId);
    const members = new Set(page.channel.members.map((member) => member.agentId));
    const agents = yield* data.agents();
    const agentTasks: AgentTask[] = [];
    const taskTraces: Array<{ agentId: string; taskId: string; messages: ConversationMessage[] }> = [];
    for (const agentId of members) {
      const tasks = yield* data.agentTasks(agentId);
      agentTasks.push(...tasks);
      // The open tasks only: a closed task's tool calls are old news for a live view.
      for (const task of tasks.filter((candidate) => candidate.state !== "closed")) {
        taskTraces.push({ agentId, taskId: task.id, messages: yield* data.taskMessages(agentId, task.id) });
      }
    }
    const exchanges = yield* data.channelExchanges(channelId);
    const watched = this.#watched.get(channelId);
    const revision = watched?.revision ?? 0;
    this.#watched.set(channelId, { members, revision });
    const snapshot = buildMonitorSnapshot({
      generatedAt: this.#now().toISOString(),
      revision,
      page,
      agents,
      agentTasks,
      taskTraces,
      liveTurns: [...this.#liveTurns.values()].filter(
        (turn) => members.has(turn.agentId) && (turn.channelId === null || turn.channelId === channelId),
      ),
      exchanges,
      attention: [...this.#attention.values()].filter((entry) => members.has(entry.agentId)),
    });
    return redactMonitorSnapshot(snapshot, this.#redact);
  });

  /** Keeps the live state from one agent event, and sends a change for each watched channel it touches. */
  observe(event: AgentEvent): void {
    const at = this.#now().toISOString();
    switch (event.type) {
      case "turn-started": {
        const channelId = this.#sources.channelForThread(event.threadId);
        const taskId = this.#taskIdForThread(event.agentId, event.threadId);
        this.#liveTurns.set(event.turnId, {
          agentId: event.agentId,
          threadId: event.threadId,
          turnId: event.turnId,
          taskId,
          channelId,
          startedAt: at,
          steps: [],
        });
        if (this.#attention.get(event.agentId)?.kind === "error") this.#attention.delete(event.agentId);
        this.#changedForAgent(event.agentId, channelId);
        return;
      }
      case "turn-progress": {
        const turn = this.#liveTurns.get(event.turnId);
        if (!turn) return;
        const running = turn.steps.at(-1);
        if (running && running.endedAt === null) running.endedAt = at;
        turn.steps.push({ id: String(turn.steps.length + 1), text: event.detail, startedAt: at, endedAt: null });
        if (turn.steps.length > LIVE_STEP_LIMIT) turn.steps.shift();
        this.#changedForAgent(turn.agentId, turn.channelId);
        return;
      }
      case "turn-completed": {
        const turn = this.#liveTurns.get(event.turnId);
        this.#liveTurns.delete(event.turnId);
        if (event.status === "failed") {
          this.#attention.set(event.agentId, { agentId: event.agentId, kind: "error", detail: null, at });
        }
        this.#changedForAgent(event.agentId, turn?.channelId ?? null);
        return;
      }
      case "error":
        if (!event.agentId) return;
        this.#attention.set(event.agentId, { agentId: event.agentId, kind: "error", detail: event.message, at });
        this.#changedForAgent(event.agentId, null);
        return;
      case "prompt":
        this.#attention.set(event.agentId, { agentId: event.agentId, kind: "waiting", detail: null, at });
        this.#changedForAgent(event.agentId, null);
        return;
      case "approval":
        this.#attention.set(event.approval.agentId, {
          agentId: event.approval.agentId,
          kind: "waiting",
          detail: null,
          at,
        });
        this.#changedForAgent(event.approval.agentId, null);
        return;
      case "agent-input-resolved":
        if (this.#attention.get(event.agentId)?.kind === "waiting") this.#attention.delete(event.agentId);
        this.#changedForAgent(event.agentId, null);
        return;
      case "channels-changed":
        this.#changed(event.channelId);
        return;
      case "agent-tasks-changed":
        this.#changedForAgent(event.snapshot.agentId, null);
        return;
      case "queue-changed":
        this.#changedForAgent(event.snapshot.agentId, null);
        return;
      case "agents-changed":
        for (const channelId of this.#watched.keys()) this.#changed(channelId);
        return;
      default:
        return;
    }
  }

  /** Stops the change timers. The live state goes with the process. */
  dispose(): void {
    for (const timer of this.#pending.values()) clearTimeout(timer);
    this.#pending.clear();
  }

  #taskIdForThread(agentId: string, threadId: string): string | null {
    try {
      return this.#sources.agentTasks(agentId).find((task) => task.threadId === threadId)?.id ?? null;
    } catch {
      return null;
    }
  }

  #changedForAgent(agentId: string, channelId: string | null): void {
    for (const [watchedId, watched] of this.#watched) {
      if (watched.members.has(agentId) && (channelId === null || channelId === watchedId)) this.#changed(watchedId);
    }
  }

  #changed(channelId: string): void {
    const watched = this.#watched.get(channelId);
    if (!watched || this.#pending.has(channelId)) return;
    this.#pending.set(
      channelId,
      setTimeout(() => {
        this.#pending.delete(channelId);
        const current = this.#watched.get(channelId);
        if (!current) return;
        current.revision += 1;
        this.#onChange({ channelId, revision: current.revision });
      }, CHANGE_COALESCE_MS),
    );
  }
}
