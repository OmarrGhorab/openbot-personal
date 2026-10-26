/**
 * The shared Monitor parts in every visual state: each status, the selected state, progress, and
 * each tool kind. The data is sample data; the clock is fixed so the times do not move.
 */

import type { AvatarHue } from "@openbot/contracts/ipc";
import { Heading, SlidingTabs } from "@openbot/ui";
import { AgentNodeCard } from "@openbot/ui/features/monitor/AgentNodeCard";
import { AgentRow } from "@openbot/ui/features/monitor/AgentRow";
import { ChannelRow } from "@openbot/ui/features/monitor/ChannelRow";
import { FeedItem } from "@openbot/ui/features/monitor/FeedItem";
import {
  MonitorCanvasBoard,
  type MonitorCanvasEdge,
  type MonitorCanvasNode,
} from "@openbot/ui/features/monitor/MonitorCanvasBoard";
import { MonitorCanvasFooter } from "@openbot/ui/features/monitor/MonitorCanvasFooter";
import { MonitorChannelHeader } from "@openbot/ui/features/monitor/MonitorChannelHeader";
import { type MonitorLiveStatus, MonitorSidebar } from "@openbot/ui/features/monitor/MonitorSidebar";
import { MONITOR_STATUSES } from "@openbot/ui/features/monitor/monitor-status";
import { ProgressBar } from "@openbot/ui/features/monitor/ProgressBar";
import { StatChip } from "@openbot/ui/features/monitor/StatChip";
import { StatusLine, StatusPill } from "@openbot/ui/features/monitor/StatusPill";
import { ToolCallRow } from "@openbot/ui/features/monitor/ToolCallRow";
import { createSignal, For } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const NOW = new Date("2026-10-26T12:00:00Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

function face(seed: string, hue: AvatarHue) {
  return { avatarSeed: seed, avatarHue: hue, avatarUrl: null };
}

const developer = face("developer", 215);
const designer = face("designer", 280);
const researcher = face("researcher", 55);
const tester = face("qa-tester", 0);
const chief = face("chief", 150);

const meta = {
  title: "Monitor/Shared parts",
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Status: Story = {
  render: () => (
    <main class="foundation-story">
      <Heading as="h1" size="lg">
        Status pill
      </Heading>
      <div class="foundation-story-row">
        <For each={MONITOR_STATUSES}>{(status) => <StatusPill status={status} />}</For>
        <StatusPill status="done" label="Live" />
      </div>
      <Heading as="h2" size="md">
        Status line
      </Heading>
      <div class="foundation-story-stack" style={{ width: "240px" }}>
        <For each={MONITOR_STATUSES}>{(status) => <StatusLine status={status} meta="4m" />}</For>
        <StatusLine status="waiting" label="Waiting on Chief" meta="4m" />
      </div>
    </main>
  ),
};

export const Stats: Story = {
  render: () => (
    <main class="foundation-story">
      <Heading as="h1" size="lg">
        Stat chip
      </Heading>
      <div class="foundation-story-row">
        <StatChip status="working" value={4} />
        <StatChip status="waiting" value={2} />
        <StatChip status="error" value={1} label="Errors" />
        <StatChip status="done" value={12} />
        <StatChip status="idle" value={3} />
        <StatChip value={1248} label="Tool calls" />
      </div>
    </main>
  ),
};

export const Progress: Story = {
  render: () => (
    <main class="foundation-story">
      <Heading as="h1" size="lg">
        Progress bar
      </Heading>
      <div class="foundation-story-stack" style={{ width: "560px" }}>
        <ProgressBar value={0.6} step={{ index: 3, total: 5 }} label="Wiring data" />
        <ProgressBar value={0.6} step={{ index: 3, total: 5 }} label="Wiring data" detail="started 14 min ago" />
        <ProgressBar value={0.4} step={{ index: 2, total: 5 }} status="waiting" />
        <ProgressBar value={0.8} step={{ index: 4, total: 5 }} status="error" />
        <ProgressBar value={1} step={{ index: 5, total: 5 }} status="done" />
        <ProgressBar value={0} label="Not started" status="idle" />
      </div>
    </main>
  ),
};

export const AgentNodeCards: Story = {
  render: () => {
    const [selected, setSelected] = createSignal("developer");
    const select = (id: string) => () => setSelected(id);
    return (
      <main class="foundation-story">
        <Heading as="h1" size="lg">
          Agent node card
        </Heading>
        <div class="foundation-story-grid" style={{ "grid-template-columns": "repeat(3, 216px)" }}>
          <AgentNodeCard
            agent={developer}
            kicker="Engineer"
            name="Developer"
            task="Build pricing section: wire the pricing data into the new cards."
            progress={{ value: 0.6, step: { index: 3, total: 5 }, label: "Wiring data" }}
            status="working"
            statusLabel="Running"
            since={minutesAgo(14)}
            now={NOW}
            selected={selected() === "developer"}
            onSelect={select("developer")}
          />
          <AgentNodeCard
            agent={researcher}
            kicker="Research partner"
            name="Researcher"
            task="Compare 12 competitor pricing layouts and recommend one."
            status="waiting"
            statusLabel="Waiting on Chief"
            since={minutesAgo(4)}
            now={NOW}
            selected={selected() === "researcher"}
            onSelect={select("researcher")}
          />
          <AgentNodeCard
            agent={tester}
            kicker="Quality checker"
            name="QA Tester"
            task="Checkout flow failed at step 4: expected $29, got $0."
            status="error"
            since={minutesAgo(1)}
            now={NOW}
            selected={selected() === "tester"}
            onSelect={select("tester")}
          />
          <AgentNodeCard
            agent={chief}
            kicker="Channel owner"
            name="Chief"
            task="Posted the brief: redesign the pricing page and ship it by Friday."
            status="done"
            since={minutesAgo(21)}
            now={NOW}
            selected={selected() === "chief"}
            onSelect={select("chief")}
          />
          <AgentNodeCard
            agent={designer}
            kicker="Product designer"
            name="Designer"
            status="idle"
            since={minutesAgo(130)}
            now={NOW}
            selected={selected() === "designer"}
            onSelect={select("designer")}
          />
          <AgentNodeCard
            agent={designer}
            kicker="Product designer"
            name="Designer"
            task="Review the layouts and finalise the pricing cards."
            progress={{ value: 0.4, step: { index: 2, total: 5 }, label: "Reviewing" }}
            status="working"
            statusLabel="Running"
            since={minutesAgo(3)}
            now={NOW}
            selected
          />
        </div>
      </main>
    );
  },
};

export const FeedItems: Story = {
  render: () => (
    <main class="foundation-story">
      <Heading as="h1" size="lg">
        Feed item
      </Heading>
      <div class="foundation-story-stack" style={{ width: "640px" }}>
        <FeedItem
          agent={researcher}
          actor="Researcher"
          verb="handed off to"
          target="Designer"
          at={minutesAgo(2)}
          now={NOW}
          text="Shared 12 competitor screenshots and a summary of their pricing tiers."
          progress={{ value: 0.6, step: { index: 3, total: 5 }, label: "Wiring data" }}
          status="waiting"
        />
        <FeedItem
          agent={developer}
          actor="Developer"
          verb="started"
          target="Build pricing section"
          at={minutesAgo(14)}
          now={NOW}
          status="working"
        />
        <FeedItem
          agent={tester}
          actor="QA Tester"
          verb="failed"
          target="Checkout test"
          at={minutesAgo(61)}
          now={NOW}
          text="Checkout flow failed at step 4: expected $29, got $0."
          status="error"
        />
        <FeedItem actor="Omar" verb="posted in" target="#website-redesign" at={minutesAgo(0)} now={NOW} />
      </div>
    </main>
  ),
};

export const ToolCallRows: Story = {
  render: () => {
    const [selected, setSelected] = createSignal("edit");
    const select = (id: string) => () => setSelected(id);
    return (
      <main class="foundation-story">
        <Heading as="h1" size="lg">
          Tool call row
        </Heading>
        <div class="foundation-story-stack" style={{ width: "500px" }}>
          <ToolCallRow
            tool="Edit"
            argument="src/pricing/PricingCards.tsx"
            status="running"
            selected={selected() === "edit"}
            onSelect={select("edit")}
          />
          <ToolCallRow
            tool="Read"
            argument="src/pricing/pricing-data.json"
            status="done"
            durationMs={300}
            selected={selected() === "read"}
            onSelect={select("read")}
          />
          <ToolCallRow
            tool="Bash"
            argument="bun run test --related pricing"
            status="done"
            durationMs={4200}
            statusLabel="Passed"
            selected={selected() === "bash"}
            onSelect={select("bash")}
          />
          <ToolCallRow
            tool="Grep"
            argument={'"PriceTag" in src/'}
            status="done"
            durationMs={800}
            selected={selected() === "grep"}
            onSelect={select("grep")}
          />
          <ToolCallRow
            tool="WebFetch"
            argument="https://example.com/pricing"
            status="failed"
            durationMs={125_000}
            selected={selected() === "web"}
            onSelect={select("web")}
          />
          <ToolCallRow tool="mcp__linear__create_issue" argument="title: Pricing QA" status="done" durationMs={1500} />
        </div>
      </main>
    );
  },
};

const CHANNELS = [
  { id: "website-redesign", name: "website-redesign", agents: 5, working: 2, waiting: 1, errors: 1, unreadCount: 12 },
  { id: "launch-q4", name: "launch-q4", agents: 3, working: 0, waiting: 0, errors: 0, unreadCount: 0 },
  { id: "support-triage", name: "support-triage", agents: 4, working: 0, waiting: 1, errors: 0, unreadCount: 3 },
  { id: "infra-oncall", name: "infra-oncall", agents: 2, working: 0, waiting: 0, errors: 1, unreadCount: 1 },
];

const AGENTS = [
  {
    id: "developer",
    name: "Developer",
    avatar: developer,
    status: "working" as const,
    detail: "Building pricing section",
    since: minutesAgo(14),
  },
  {
    id: "designer",
    name: "Designer",
    avatar: designer,
    status: "working" as const,
    detail: "Reviewing layouts",
    since: minutesAgo(3),
  },
  {
    id: "researcher",
    name: "Researcher",
    avatar: researcher,
    status: "waiting" as const,
    detail: "Waiting on Chief",
    since: null,
  },
  {
    id: "qa-tester",
    name: "QA Tester",
    avatar: tester,
    status: "error" as const,
    detail: "Checkout test failed",
    since: null,
  },
  { id: "chief", name: "Chief", avatar: chief, status: "idle" as const, detail: null, since: minutesAgo(21) },
];

/** Agent Row and Channel Row in each state, with the selected row. */
export const SidebarRows: Story = {
  render: () => {
    const [selected, setSelected] = createSignal("developer");
    return (
      <main class="foundation-story">
        <Heading as="h1" size="lg">
          Channel row
        </Heading>
        <div class="foundation-story-stack" style={{ width: "272px" }}>
          <For each={CHANNELS}>
            {(channel, index) => <ChannelRow channel={channel} selected={index() === 0} onSelect={() => undefined} />}
          </For>
        </div>
        <Heading as="h2" size="md">
          Agent row
        </Heading>
        <div class="foundation-story-stack" style={{ width: "272px" }}>
          <For each={AGENTS}>
            {(agent) => (
              <AgentRow
                agent={agent.avatar}
                name={agent.name}
                status={agent.status}
                detail={agent.detail}
                since={agent.since}
                now={NOW}
                selected={selected() === agent.id}
                onSelect={() => setSelected(agent.id)}
              />
            )}
          </For>
        </div>
      </main>
    );
  },
};

/** The whole Monitor sidebar. A count toggles its filter; a row selects its channel or agent. */
export const Sidebar: Story = {
  render: () => {
    const [filter, setFilter] = createSignal<MonitorLiveStatus | null>(null);
    const [channel, setChannel] = createSignal<string | null>("website-redesign");
    const [agent, setAgent] = createSignal<string | null>(null);
    const [allAgents, setAllAgents] = createSignal(false);
    return (
      <div style={{ display: "flex", width: "296px", height: "820px" }}>
        <MonitorSidebar
          counts={{ working: 4, waiting: 2, error: 1 }}
          filter={filter()}
          onFilter={(status) => setFilter((current) => (current === status ? null : status))}
          updatedAt={NOW.toISOString()}
          now={NOW}
          channels={CHANNELS}
          activeChannelId={channel()}
          onSelectChannel={(id) => {
            setAllAgents(false);
            setChannel(id);
          }}
          onCreateChannel={() => undefined}
          agents={AGENTS}
          agentTotal={8}
          selectedAgentId={agent()}
          onSelectAgent={setAgent}
          onAllAgents={() => setAllAgents(true)}
          allAgentsOpen={allAgents()}
          onOpenSearch={() => undefined}
        />
      </div>
    );
  },
};

/** The five agents of the design, placed in columns by hand-off order as the app places them. */
const CANVAS_NODES: MonitorCanvasNode[] = [
  {
    id: "chief",
    position: { x: 0, y: 0 },
    card: {
      agent: chief,
      name: "Chief",
      kicker: "Channel lead",
      task: "Posted the brief: redesign the pricing page and ship it by Friday.",
      status: "done",
      since: minutesAgo(21),
    },
  },
  {
    id: "researcher",
    position: { x: 336, y: -120 },
    card: {
      agent: researcher,
      name: "Researcher",
      task: "Compare 12 competitor pricing layouts and recommend one.",
      status: "waiting",
      statusLabel: "Waiting on Chief",
      since: minutesAgo(4),
    },
  },
  {
    id: "designer",
    position: { x: 336, y: 120 },
    card: {
      agent: designer,
      name: "Designer",
      task: "Review the layouts and finalise the pricing cards.",
      progress: { value: 0.4, step: { index: 2, total: 5 }, label: "Reviewing" },
      status: "working",
      since: minutesAgo(3),
    },
  },
  {
    id: "developer",
    position: { x: 672, y: 0 },
    card: {
      agent: developer,
      name: "Developer",
      task: "Build pricing section: wire the pricing data into the new cards.",
      progress: { value: 0.6, step: { index: 3, total: 5 }, label: "Wiring data" },
      status: "working",
      since: minutesAgo(14),
    },
  },
  {
    id: "tester",
    position: { x: 1008, y: 0 },
    card: {
      agent: tester,
      name: "QA Tester",
      task: "Checkout flow failed at step 4: expected $29, got $0.",
      status: "error",
      since: minutesAgo(1),
    },
  },
];

const CANVAS_EDGES: MonitorCanvasEdge[] = [
  { id: "chief|researcher", from: "chief", to: "researcher", label: "Assigned", state: "done" },
  { id: "chief|designer", from: "chief", to: "designer", label: "Assigned", state: "done" },
  { id: "designer|researcher", from: "researcher", to: "designer", label: "9 messages", state: "active" },
  { id: "developer|researcher", from: "researcher", to: "developer", label: "12 messages", state: "done" },
  { id: "designer|developer", from: "designer", to: "developer", label: "14 messages", state: "active" },
  { id: "developer|tester", from: "developer", to: "tester", label: "Assigned", state: "done" },
];

export const Canvas: Story = {
  render: () => {
    const [selected, setSelected] = createSignal<string | null>("developer");
    return (
      <div style={{ display: "flex", width: "1080px", height: "820px" }}>
        <section class="monitor-page" style={{ flex: "1" }}>
          <SlidingTabs.Root class="monitor-channel" value="canvas">
            <MonitorChannelHeader
              name="website-redesign"
              live
              agents={CANVAS_NODES.map((node) => ({ id: node.id, name: node.card.name, avatar: node.card.agent }))}
              onOpenMembers={() => undefined}
              availableTabs={["canvas"]}
            />
            <div class="monitor-channel-body">
              <MonitorCanvasBoard
                label="website-redesign"
                nodes={CANVAS_NODES}
                edges={CANVAS_EDGES}
                selectedId={selected()}
                onSelectNode={setSelected}
                onClearSelection={() => setSelected(null)}
                onOpenEdge={() => undefined}
                now={NOW}
              >
                <MonitorCanvasFooter onAsk={() => undefined} />
              </MonitorCanvasBoard>
            </div>
          </SlidingTabs.Root>
        </section>
      </div>
    );
  },
};
