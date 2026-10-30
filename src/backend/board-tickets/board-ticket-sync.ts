import {
  BOARD_TICKET_BODY_LIMIT,
  BOARD_TICKET_EXTERNAL_KEY_LIMIT,
  BOARD_TICKET_PROVIDERS,
  BOARD_TICKET_TITLE_LIMIT,
  BOARD_TICKET_URL_LIMIT,
  type BoardTicketProvider,
  type BoardTicketSyncState,
  type BoardTicketSyncTarget,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { Effect, Result, Schema } from "effect";
import type { BoardTicketActivity, BoardTicketService } from "./board-ticket-service";
import type { BoardTicketStore } from "./board-ticket-store";
import type { BoardTicketSyncIssue, BoardTicketSyncSource } from "./board-ticket-sync-source";

/** How often the board imports the open issues of its sync target. */
const SYNC_INTERVAL_MS = 5 * 60 * 1000;

/** A sync request that failed. The cause is an error with a catalog text, never a token or a response body. */
class BoardTicketSyncFailed extends Schema.TaggedError<BoardTicketSyncFailed>()("BoardTicketSyncFailed", {
  cause: Schema.Defect(),
}) {}

type BoardTicketSyncErrorKey =
  | "error.agent.boardTickets.syncNotConnected"
  | "error.agent.boardTickets.syncProjectInvalid"
  | "error.agent.boardTickets.syncProjectsFailed"
  | "error.agent.boardTickets.syncFailed";

export interface BoardTicketSyncOptions {
  store: BoardTicketStore;
  board: BoardTicketService;
  /** The adapter of each ticket system that the board can sync with. */
  sources: Partial<Record<BoardTicketProvider, BoardTicketSyncSource>>;
  /** The ticket systems that are connected on this computer now. Read at each call. */
  connected: () => readonly BoardTicketProvider[];
  /** Gets the new state after a change of the target, of a connection, or after an import. */
  changed: (state: BoardTicketSyncState) => void;
  now?: () => string;
  intervalMs?: number;
}

/**
 * The sync of the Tickets board with one ticket system. It works only while that system is connected on
 * this computer. Then it imports the open issues of the chosen repository or project into Backlog, each
 * linked to its issue, and sends each move and each agent comment of a linked ticket back to the issue
 * where the system supports it. The tickets stay rows in this computer's database: a lost connection
 * stops the sync and keeps every ticket. Without a connection it makes no call. It never imports the
 * database facade.
 */
export class BoardTicketSync {
  readonly #options: BoardTicketSyncOptions;
  readonly #pushes = new Set<Promise<void>>();
  #timer: ReturnType<typeof setInterval> | null = null;
  #pass: Promise<void> | null = null;
  #unsubscribe: (() => void) | null = null;
  #error: string | null = null;

  constructor(options: BoardTicketSyncOptions) {
    this.#options = options;
  }

  state(): BoardTicketSyncState {
    const providers = this.#providers();
    const settings = this.#options.store.settings();
    const target =
      settings.syncProvider !== null && settings.syncProject !== null && providers.includes(settings.syncProvider)
        ? { provider: settings.syncProvider, project: settings.syncProject }
        : null;
    return { providers, target, lastSyncedAt: settings.lastSyncedAt, error: target ? this.#error : null };
  }

  /** The repositories or projects of a connected ticket system, for the target picker. */
  readonly projects = Effect.fn("BoardTicketSync.projects")(function* (
    this: BoardTicketSync,
    provider: BoardTicketProvider,
  ): Effect.fn.Return<string[], BoardTicketSyncFailed> {
    const source = yield* this.#connectedSource(provider);
    return yield* source.projects().pipe(Effect.mapError(() => failure("error.agent.boardTickets.syncProjectsFailed")));
  }).bind(this);

  /** Saves the sync target and imports its issues at once. Null stops the sync; the tickets stay. */
  readonly setTarget = Effect.fn("BoardTicketSync.setTarget")(function* (
    this: BoardTicketSync,
    target: BoardTicketSyncTarget | null,
  ): Effect.fn.Return<BoardTicketSyncState, BoardTicketSyncFailed> {
    const { store } = this.#options;
    if (target === null) {
      store.setSettings({ syncProvider: null, syncProject: null, lastSyncedAt: null });
      this.#error = null;
      return this.#announce();
    }
    const source = yield* this.#connectedSource(target.provider);
    const project = target.project.trim();
    if (!source.isProject(project)) return yield* failure("error.agent.boardTickets.syncProjectInvalid");
    const current = store.settings();
    const same = current.syncProvider === target.provider && current.syncProject === project;
    store.setSettings({
      syncProvider: target.provider,
      syncProject: project,
      lastSyncedAt: same ? current.lastSyncedAt : null,
    });
    this.#error = null;
    this.#announce();
    return yield* this.syncNow();
  }).bind(this);

  /**
   * Imports the open issues of the target now. A pass that already runs is awaited, not started again.
   * A failed read is kept in the state, so the board shows it; the tickets stay as they were.
   */
  readonly syncNow = Effect.fn("BoardTicketSync.syncNow")(function* (
    this: BoardTicketSync,
  ): Effect.fn.Return<BoardTicketSyncState, BoardTicketSyncFailed> {
    yield* Effect.promise(() => this.#runPass());
    return this.state();
  }).bind(this);

  /**
   * Finds one issue by its key in the open issues of its repository or project (#200: a chat message names
   * it), and adds it to Backlog as an import does. Answers the issue's key as the system gives it, or null
   * when the issue is not open there. Fails when the system is not connected or the read fails. It works
   * also when the board syncs with another target, or with none.
   */
  readonly importIssueByKey = Effect.fn("BoardTicketSync.importIssueByKey")(function* (
    this: BoardTicketSync,
    provider: BoardTicketProvider,
    key: string,
  ): Effect.fn.Return<string | null, BoardTicketSyncFailed> {
    const source = yield* this.#connectedSource(provider);
    const project = issueProject(provider, key);
    if (project === null || !source.isProject(project)) return null;
    const issues = yield* source
      .openIssues(project)
      .pipe(Effect.mapError(() => failure("error.agent.boardTickets.syncFailed")));
    const wanted = key.toLowerCase();
    const issue = issues.find((candidate) => candidate.key.toLowerCase() === wanted);
    if (!issue) return null;
    this.#importIssue(provider, issue);
    return issue.key;
  }).bind(this);

  /** Starts the timer and the push of moves and comments. The timer does not keep the app running. */
  start(): void {
    if (this.#timer) return;
    this.#unsubscribe = this.#options.board.onActivity((activity) => this.#push(activity));
    this.#timer = setInterval(() => {
      this.#runPass().catch(() => undefined);
    }, this.#options.intervalMs ?? SYNC_INTERVAL_MS);
    this.#timer.unref();
  }

  /** Sends the state again after a connection changed, so the board shows or hides its sync control. */
  connectionChanged(): void {
    this.#announce();
  }

  /** Resolves when every push that runs now has ended. */
  async whenPushed(): Promise<void> {
    await Promise.all([...this.#pushes]);
  }

  /** Stops the timer and the push, and waits for an import or a push in progress. */
  async stop(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    await this.#pass?.catch(() => undefined);
    await this.whenPushed();
  }

  #runPass(): Promise<void> {
    if (!this.#pass) {
      this.#pass = Effect.runPromise(this.#importIssues()).finally(() => {
        this.#pass = null;
      });
    }
    return this.#pass;
  }

  readonly #importIssues = Effect.fn("BoardTicketSync.importIssues")(function* (this: BoardTicketSync) {
    const target = this.state().target;
    const source = target ? this.#options.sources[target.provider] : undefined;
    if (!target || !source) return;
    const read = yield* Effect.result(source.openIssues(target.project));
    if (Result.isFailure(read)) {
      this.#error = sourceText("error.agent.boardTickets.syncFailed");
      this.#announce();
      return;
    }
    // The person can change or stop the target while the request runs.
    const current = this.state().target;
    if (current?.provider !== target.provider || current.project !== target.project) return;
    for (const issue of read.success) this.#importIssue(target.provider, issue);
    const settings = this.#options.store.settings();
    this.#options.store.setSettings({ ...settings, lastSyncedAt: this.#now() });
    this.#error = null;
    this.#announce();
  }).bind(this);

  /**
   * Adds an issue to Backlog once, with the type that its labels, title or text show. A linked ticket takes
   * the new title and text, keeps its column, and gets the type again unless a person or an agent chose it.
   */
  #importIssue(provider: BoardTicketProvider, issue: BoardTicketSyncIssue): void {
    if (issue.key.length > BOARD_TICKET_EXTERNAL_KEY_LIMIT || issue.url.length > BOARD_TICKET_URL_LIMIT) return;
    const { store, board } = this.#options;
    const title = issue.title.replace(/\s+/gu, " ").trim().slice(0, BOARD_TICKET_TITLE_LIMIT) || issue.key;
    const body = issue.body.slice(0, BOARD_TICKET_BODY_LIMIT);
    const labels = issue.labels ?? [];
    const linked = store.forExternal(provider, issue.key);
    if (!linked) {
      board.create({ title, body }, "sync", { external: { provider, key: issue.key, url: issue.url } }, labels);
      return;
    }
    if (linked.title !== title || linked.body !== body) board.update({ ticketId: linked.id, title, body }, "sync");
    board.redetectType(linked.id, { labels, title, body }, "sync");
  }

  /**
   * Sends a move or an agent comment of a linked ticket to its issue. The sync's own changes and the
   * person's messages to the work thread stay on this computer. A failed push puts a failure line on the
   * ticket, and the next push that works removes it.
   */
  #push(activity: BoardTicketActivity): void {
    if (activity.actor === "sync") return;
    if (activity.kind === "comment" && activity.actor !== "agent") return;
    const external = activity.ticket.external;
    if (!external || !this.#providers().includes(external.provider)) return;
    const source = this.#options.sources[external.provider];
    if (!source) return;
    const ticketId = activity.ticket.id;
    const send =
      activity.kind === "moved"
        ? source.move(external.key, activity.from, activity.to)
        : source.comment(external.key, activity.text);
    const pushed: Promise<void> = Effect.runPromise(Effect.result(send))
      .then((result) => this.#markPush(ticketId, Result.isSuccess(result)))
      .catch(() => undefined)
      .finally(() => {
        this.#pushes.delete(pushed);
      });
    this.#pushes.add(pushed);
  }

  #markPush(ticketId: string, worked: boolean): void {
    const ticket = this.#options.board.get(ticketId);
    if (!ticket) return;
    const failed = sourceText("error.agent.boardTickets.pushFailed");
    if (!worked && ticket.error !== failed) this.#options.board.patch(ticketId, { error: failed }, "sync");
    if (worked && ticket.error === failed) this.#options.board.patch(ticketId, { error: null }, "sync");
  }

  #providers(): BoardTicketProvider[] {
    const connected = this.#options.connected();
    return BOARD_TICKET_PROVIDERS.filter(
      (provider) => connected.includes(provider) && this.#options.sources[provider] !== undefined,
    );
  }

  #connectedSource(provider: BoardTicketProvider): Effect.Effect<BoardTicketSyncSource, BoardTicketSyncFailed> {
    const source = this.#options.sources[provider];
    return source && this.#providers().includes(provider)
      ? Effect.succeed(source)
      : Effect.fail(failure("error.agent.boardTickets.syncNotConnected"));
  }

  #announce(): BoardTicketSyncState {
    const state = this.state();
    this.#options.changed(state);
    return state;
  }

  #now(): string {
    return this.#options.now?.() ?? new Date().toISOString();
  }
}

/** The repository (`owner/repo`) of a GitHub key, or the project (`PROJ`) of a Jira or Linear key. */
function issueProject(provider: BoardTicketProvider, key: string): string | null {
  if (provider === "github") {
    const hash = key.lastIndexOf("#");
    return hash > 0 ? key.slice(0, hash) : null;
  }
  const dash = key.lastIndexOf("-");
  return dash > 0 ? key.slice(0, dash) : null;
}

function failure(key: BoardTicketSyncErrorKey): BoardTicketSyncFailed {
  return new BoardTicketSyncFailed({ cause: new Error(sourceText(key)) });
}
