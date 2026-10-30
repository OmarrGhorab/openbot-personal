import type { BoardTicket, BoardTicketStatus, BoardTicketType } from "@openbot/contracts/ipc";
import {
  TicketCard,
  type TicketReviewActions,
  TicketsAutopilotPill,
  TicketsColumns,
  TicketsFilterChips,
  TicketsLanes,
  TicketsSummaryLine,
} from "@openbot/ui/features/tickets/TicketsBoard";
import { filterTickets, type TicketsAutopilot, type TicketsFilter } from "@openbot/ui/features/tickets/tickets-model";
import "@openbot/ui/features/tickets/tickets.css";
import { createSignal, For } from "solid-js";
import { fn } from "storybook/test";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { STORY_AGENTS } from "./fixtures";

// The ticket card v2 of the Tickets board (#188, Figma "Ticket card v2" in node 146-414) in every
// state: Backlog, Queued with and without a thread, Running, Running in review, Needs review waiting,
// Needs review blocked, a failed turn, Done, unassigned, a long title and the compact card of the lanes.

const NOW = new Date("2026-10-30T12:00:00.000Z");

function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

let sequence = 0;

function ticket(
  status: BoardTicketStatus,
  title: string,
  extra: Partial<BoardTicket> & { type?: BoardTicketType | null; enteredMinutesAgo?: number } = {},
): BoardTicket {
  sequence += 1;
  const entered = minutesAgo(extra.enteredMinutesAgo ?? 14);
  return {
    id: `story-ticket-${sequence}`,
    title,
    body: "",
    status,
    type: "feature",
    typeSource: "detected",
    agentId: STORY_AGENTS[0]?.id ?? null,
    order: sequence,
    taskId: null,
    threadId: null,
    teamJobId: null,
    teamRoleId: null,
    external: { provider: "jira", key: `OPS-${140 + sequence}`, url: "https://example.com/OPS" },
    progress: null,
    error: null,
    statusTimes: { [status]: entered },
    statusChangedAt: entered,
    createdAt: minutesAgo(600),
    updatedAt: entered,
    ...extra,
  };
}

const TICKETS: BoardTicket[] = [
  ticket("backlog", "Add dark mode to settings", { agentId: null, enteredMinutesAgo: 120 }),
  ticket("backlog", "Write onboarding copy", { type: "chore", enteredMinutesAgo: 180 }),
  ticket("queued", "Migrate invoices to the new API"),
  ticket("queued", "Summarise competitor pricing", { type: "chore", taskId: "task-q", threadId: "thread-q" }),
  ticket("running", "Build pricing section", {
    taskId: "task-1",
    threadId: "thread-1",
    progress: "Writing the pricing table component",
  }),
  ticket("running", "Review layouts and finalise cards", {
    taskId: "task-2",
    threadId: "thread-2",
    teamJobId: "job-1",
    teamRoleId: "reviewer",
    progress: "Checking spacing on the mobile layout",
    enteredMinutesAgo: 3,
  }),
  ticket("needs_review", "Draft launch copy", { type: "chore", taskId: "task-3", threadId: "thread-3" }),
  ticket("needs_review", "Checkout flow test", {
    type: "bug",
    taskId: "task-4",
    threadId: "thread-4",
    teamJobId: "job-2",
    error: "Turn failed: checkout test timed out",
  }),
  ticket("done", "Post the project brief", { type: "chore", progress: "PASS · Quality 10/10" }),
  ticket("running", "Make the very long ticket titles wrap onto two lines without cutting a single word off the card", {
    type: null,
    typeSource: null,
    taskId: "task-5",
    threadId: "thread-5",
    progress: "A progress line that is long enough to need two lines on a narrow card",
    external: { provider: "github", key: "omarrghorab/openbot-personal#158", url: "https://example.com/158" },
  }),
];

const REVIEW: TicketReviewActions = { onApprove: fn(), onRequestChanges: fn() };

/** The cards at the board's narrowest column width, 213px. */
function CardGrid(props: { compact?: boolean; tickets?: readonly BoardTicket[] }) {
  const tickets = () => props.tickets ?? TICKETS;
  return (
    <div style={{ display: "flex", "flex-wrap": "wrap", gap: "12px", padding: "16px", "align-items": "flex-start" }}>
      <For each={tickets()} keyed={(item) => item.id}>
        {(item) => (
          <div style={{ width: "213px" }}>
            <TicketCard
              agents={STORY_AGENTS}
              tickets={tickets()}
              snapshots={{}}
              now={NOW}
              ticket={item()}
              selected={false}
              onSelect={fn()}
              compact={props.compact}
              review={REVIEW}
            />
          </div>
        )}
      </For>
    </div>
  );
}

const meta = {
  title: "Tickets/Ticket card",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** Every state: Backlog, Queued, Running, in review, waiting for review with Approve and Changes, blocked with a failed turn, Done, and a long title. */
export const EveryState: Story = { render: () => <CardGrid /> };
/** The compact card of the By agent lanes: no key in the top row. */
export const Compact: Story = { render: () => <CardGrid compact /> };
/** One selected card: its border takes the accent. */
export const Selected: Story = {
  render: () => (
    <div style={{ width: "213px", padding: "16px" }}>
      <TicketCard
        agents={STORY_AGENTS}
        tickets={TICKETS}
        snapshots={{}}
        now={NOW}
        ticket={TICKETS[4] ?? ticket("running", "Selected")}
        selected={true}
        onSelect={fn()}
        review={REVIEW}
      />
    </div>
  ),
};

/** The board header and columns (#189): the summary line, the filter chips, and the Autopilot marks when on. */
function BoardStory(props: { autopilot: TicketsAutopilot }) {
  const [filter, setFilter] = createSignal<TicketsFilter | null>(null);
  const firstBacklog = () => TICKETS.find((item) => item.status === "backlog")?.id;
  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "12px", padding: "16px" }}>
      <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
        <TicketsAutopilotPill tickets={TICKETS} autopilot={props.autopilot} />
      </div>
      <TicketsSummaryLine tickets={TICKETS} autopilot={props.autopilot} />
      <TicketsFilterChips
        agents={STORY_AGENTS}
        tickets={TICKETS}
        snapshots={{}}
        filter={filter()}
        onFilter={setFilter}
      />
      <TicketsColumns
        agents={STORY_AGENTS}
        tickets={filterTickets(TICKETS, filter())}
        snapshots={{}}
        now={NOW}
        selectedTicketId={null}
        onSelectTicket={fn()}
        review={REVIEW}
        autopilot={props.autopilot}
        nextTicketId={props.autopilot.enabled ? firstBacklog() : undefined}
        onQuickAdd={fn()}
      />
    </div>
  );
}

/** The board with Autopilot off: no pill, no marker, no "Auto-merge on". A chip filters; a second click clears. */
export const Board: Story = { render: () => <BoardStory autopilot={{ enabled: false, slots: 0, autoMerge: false }} /> };
/** The board with Autopilot on: "Autopilot on · 0 of 2 slots", "Raven picks this next" and "Auto-merge on" in Done. */
export const BoardAutopilot: Story = {
  render: () => <BoardStory autopilot={{ enabled: true, slots: 2, autoMerge: true }} />,
};

/** By agent (#190, Figma 153-635): the status names once on top, one lane for each agent and the unassigned lane, dashed empty slots, compact cards. */
export const Lanes: Story = {
  render: () => (
    <div style={{ padding: "16px", overflow: "auto" }}>
      <TicketsLanes
        agents={STORY_AGENTS}
        tickets={TICKETS}
        snapshots={{}}
        now={NOW}
        selectedTicketId={null}
        onSelectTicket={fn()}
        onSelectAgent={fn()}
        review={REVIEW}
      />
    </div>
  ),
};
