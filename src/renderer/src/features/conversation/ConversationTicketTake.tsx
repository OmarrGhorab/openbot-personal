import {
  type BoardTicketProvider,
  detectTicketTakeRequest,
  type RavenAutopilotSettings,
  type RavenTeamJob,
  type RavenTicketTakeResult,
  ravenAutopilotMayMerge,
} from "@openbot/contracts/ipc";
import { TicketTakeNotice, TicketTakenCard } from "@openbot/ui/features/tickets/TicketTakenCard";
import { createSignal, For, onCleanup, Show } from "solid-js";

/** How many "Ticket taken" cards one chat shows: the newest ones. */
const CARD_LIMIT = 3;

/** The agent's answer when it could not take a ticket. It lives until the chat closes, as a reply does. */
type TicketTakeNoticeItem =
  | { kind: "connect"; key: string; provider: BoardTicketProvider }
  | { kind: "failed"; key: string; reason: string };

/**
 * Chat (#200): the take requests of this computer's agents and the jobs they started. Make it in the
 * component that owns the chat. It reads the team jobs and the Autopilot settings once, and again at each change event,
 * so every card follows its job live. Main reads each message again; this only asks.
 */
export function createChatTicketTake() {
  const [jobs, setJobs] = createSignal<RavenTeamJob[]>([]);
  const [settings, setSettings] = createSignal<RavenAutopilotSettings | null>(null);
  const [notices, setNotices] = createSignal<Record<string, TicketTakeNoticeItem[]>>({});

  const loadJobs = () =>
    window.openbot.ravenTeam
      .listJobs()
      .then(setJobs)
      .catch(() => undefined);

  // The reads start with the owner and end with it.
  void loadJobs();
  window.openbot.ravenAutopilot
    .get()
    .then(setSettings)
    .catch(() => undefined);
  const stopJobs = window.openbot.ravenTeam.onChanged(() => void loadJobs());
  const stopSettings = window.openbot.ravenAutopilot.onChanged(setSettings);
  onCleanup(() => {
    stopJobs();
    stopSettings();
  });

  function addNotice(agentId: string, notice: TicketTakeNoticeItem) {
    setNotices((current) => ({ ...current, [agentId]: [...(current[agentId] ?? []), notice].slice(-CARD_LIMIT) }));
  }

  /**
   * After a message to a local agent went out: when it names a ticket and asks to take it, main takes it.
   * A connect or a failure answer shows as the agent's notice in that chat.
   */
  async function afterSend(agentId: string, text: string): Promise<void> {
    if (!detectTicketTakeRequest(text)) return;
    let result: RavenTicketTakeResult;
    try {
      result = await window.openbot.ravenTeam.takeTicket({ agentId, text });
    } catch {
      return;
    }
    switch (result.outcome) {
      case "taken":
        await loadJobs();
        return;
      case "connect":
        addNotice(agentId, { kind: "connect", key: result.key, provider: result.provider });
        return;
      case "failed":
        addNotice(agentId, { kind: "failed", key: result.key, reason: result.reason });
        return;
      default:
        return;
    }
  }

  /** The jobs that this agent took from its chat, oldest first, at most the newest few. */
  const jobsFor = (agentId: string) =>
    jobs()
      .filter((job) => job.decision?.chat?.agentId === agentId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(-CARD_LIMIT);

  return {
    afterSend,
    jobsFor,
    noticesFor: (agentId: string) => notices()[agentId] ?? [],
    /** The issue key of a job's ticket, as the decision kept it, or from a title such as `PROJ-482: …`. */
    keyOf: (job: RavenTeamJob) => job.decision?.chat?.ticketKey ?? keyFromTitle(job.decision?.ticketTitle ?? ""),
    mayMerge: (job: RavenTeamJob) => {
      const current = settings();
      return current !== null && ravenAutopilotMayMerge(current, job.decision?.ticketType ?? null);
    },
    notifyOnMerge: () => settings()?.notifyOnMerge ?? true,
    stop: (jobId: string) => window.openbot.ravenTeam.stop(jobId).then(loadJobs),
  };
}

type ChatTicketTake = ReturnType<typeof createChatTicketTake>;

/** A key at the start of a title, such as `PROJ-482` in "PROJ-482: Checkout fails". Null when it has none. */
function keyFromTitle(title: string): string | null {
  const match = /^([A-Z][A-Z0-9]{1,9}-\d{1,7}|[\w.-]+\/[\w.-]+#\d{1,9})(?::|\s)/u.exec(title);
  return match?.[1] ?? null;
}

/**
 * The "Ticket taken" cards and the take notices of one agent's chat, under its timeline (Figma 167-2054).
 */
export function ConversationTicketTake(props: {
  take: ChatTicketTake;
  agentId: string;
  onOpenBoard: (trigger: HTMLElement) => void;
  onConnect?: ((provider: BoardTicketProvider) => void) | undefined;
}) {
  return (
    <Show when={props.take.jobsFor(props.agentId).length > 0 || props.take.noticesFor(props.agentId).length > 0}>
      <div class="ticket-taken-list">
        <For each={props.take.jobsFor(props.agentId)} keyed={(job) => job.id}>
          {(job) => (
            <TicketTakenCard
              job={job()}
              ticketKey={props.take.keyOf(job())}
              mayMerge={props.take.mayMerge(job())}
              notifyOnMerge={props.take.notifyOnMerge()}
              onOpenBoard={props.onOpenBoard}
              onStop={props.take.stop}
            />
          )}
        </For>
        <For each={props.take.noticesFor(props.agentId)}>
          {(notice) => (
            <TicketTakeNotice
              kind={notice.kind}
              ticketKey={notice.key}
              provider={notice.kind === "connect" ? notice.provider : null}
              reason={notice.kind === "failed" ? notice.reason : ""}
              onConnect={props.onConnect}
            />
          )}
        </For>
      </div>
    </Show>
  );
}
