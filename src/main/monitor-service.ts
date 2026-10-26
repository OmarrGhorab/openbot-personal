// The Monitor of a channel on this computer. It reads the local sources (the channel page, the
// agents and their tasks, and the mailbox), keeps the live turns from the agent events, and builds
// one snapshot with `buildMonitorSnapshot`. Tool-call text and errors are redacted here, before a
// snapshot leaves main. It sends a change for a channel only after a window read that channel.

import type {
  AgentEvent,
  AgentTask,
  ChannelPage,
  ConversationMessage,
  MonitorAgentSource,
  MonitorChange,
  MonitorExchange,
  MonitorSnapshot,
} from "@openbot/contracts/ipc";
import {
  buildMonitorSnapshot,
  MonitorLiveState,
  redactMonitorSnapshot as redactContractSnapshot,
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
          catch: () =>
            new MonitorChannelMissing({ cause: new Error(sourceText("error.backend.monitorChannelMissing")) }),
        }),
      agents: () => readSource(() => sources.agents()),
      agentTasks: (agentId) => readSource(() => sources.agentTasks(agentId)),
      taskMessages: (agentId, taskId) => readSource(() => sources.taskMessages(agentId, taskId)),
      channelExchanges: (channelId) => readSource(() => sources.channelExchanges(channelId)),
    });
  }
}

/** Changes that arrive within this time reach the window as one. A streaming reply sends many events. */
const CHANGE_COALESCE_MS = 200;

/** Removes secrets from every tool-call text and error of a snapshot, with the log redaction by default. */
export function redactMonitorSnapshot(
  snapshot: MonitorSnapshot,
  redact: (text: string) => string = redactText,
): MonitorSnapshot {
  return redactContractSnapshot(snapshot, redact);
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
  /** The turns that run now, and the newest prompt, approval or error of each agent. */
  readonly #live: MonitorLiveState;
  /** The channels a window read, with their members at that read, and their revision. */
  readonly #watched = new Map<string, { members: Set<string>; revision: number }>();
  readonly #pending = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(options: MonitorServiceOptions) {
    this.#sources = options.sources;
    this.#dataSource = MonitorDataSource.make(options.sources);
    this.#onChange = options.onChange;
    this.#now = options.now ?? (() => new Date());
    this.#redact = options.redact ?? redactText;
    this.#live = new MonitorLiveState({
      channelForThread: (threadId) => this.#sources.channelForThread(threadId),
      taskIdForThread: (agentId, threadId) => this.#taskIdForThread(agentId, threadId),
    });
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
      liveTurns: this.#live.turns(members, channelId),
      exchanges,
      attention: this.#live.attention(members),
    });
    return redactMonitorSnapshot(snapshot, this.#redact);
  });

  /** Keeps the live state from one agent event, and sends a change for each watched channel it touches. */
  observe(event: AgentEvent): void {
    const change = this.#live.observe(event, this.#now().toISOString());
    if (!change) return;
    if (change.kind === "agent") this.#changedForAgent(change.agentId, change.channelId);
    else if (change.kind === "channel") this.#changed(change.channelId);
    else for (const channelId of this.#watched.keys()) this.#changed(channelId);
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
