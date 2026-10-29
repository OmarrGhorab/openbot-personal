import type { AgentEvent, AgentTask, BoardTicket } from "@openbot/contracts/ipc";
import type { ServerView } from "@openbot/ui/features/servers/ServerMenu";
import { onCleanup } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { App } from "../src/App";
import { LEFT_PANEL_COLLAPSED_STORAGE_KEY, SERVER_VIEW_STORAGE_KEY } from "../src/layout-constants";
import { createMockOpenBot, type MockOpenBotOptions } from "../src/preview/mock-openbot";
import { OpenBotPlayground } from "../src/preview/OpenBotPlayground";
import { STORY_AGENT_STATUS, STORY_AGENT_SUMMARIES, STORY_APP_INFO, STORY_SERVERS } from "./fixtures";

const [storyLocalServer, storyRemoteServer] = STORY_SERVERS;
if (!storyLocalServer || !storyRemoteServer) throw new Error("Story server fixtures need a local and a remote server.");

const meta = {
  title: "App",
  component: App,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof App>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Sets one stored layout value for the story, and puts the old value back when the story ends. */
function useStoredLayoutValue(key: string, value: string): void {
  const previous = window.localStorage.getItem(key);
  window.localStorage.setItem(key, value);
  onCleanup(() => {
    if (previous === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, previous);
  });
}

function SidebarStatePlayground(props: { compact: boolean; serverView?: ServerView; options?: MockOpenBotOptions }) {
  useStoredLayoutValue(LEFT_PANEL_COLLAPSED_STORAGE_KEY, props.compact ? "true" : "false");
  if (props.serverView) useStoredLayoutValue(SERVER_VIEW_STORAGE_KEY, props.serverView);
  return <OpenBotPlayground options={props.options} />;
}

export const Playground: Story = {
  render: () => <OpenBotPlayground />,
};

export const ExpandedSidebar: Story = {
  render: () => <SidebarStatePlayground compact={false} />,
};

/** The servers in a rail at the left of the sidebar, instead of the server menu. */
export const ServerRailView: Story = {
  render: () => <SidebarStatePlayground compact={false} serverView="rail" />,
};

export const CompactSidebar: Story = {
  render: () => <SidebarStatePlayground compact={true} />,
};

export const LinuxWindow: Story = {
  render: () => (
    <SidebarStatePlayground compact={false} options={{ appInfo: { ...STORY_APP_INFO, platform: "linux" } }} />
  ),
};

/** On a Mac where macOS refuses OpenBot access to Mail and Messages: installing Apple apps names them. */
export const MacAutomationRefused: Story = {
  render: () => <OpenBotPlayground options={{ macAutomationAnswers: { mail: "denied", messages: "denied" } }} />,
};

/** On a Mac where OpenBot cannot ask macOS about Safari: installing Apple apps says to try again. */
export const MacAutomationFailed: Story = {
  render: () => <OpenBotPlayground options={{ macAutomationAnswers: { safari: "failed" } }} />,
};

export const EmptyWorkspace: Story = {
  render: () => (
    <OpenBotPlayground
      options={{
        agents: [],
        servers: STORY_SERVERS.filter((server) => server.kind === "local"),
        presence: { serverId: "local", updatedAt: "2026-08-24T12:00:00.000Z", members: [] },
        directThreads: [],
        teamMembers: [],
        browserTabs: [],
        remoteDesktopSessions: [],
      }}
    />
  ),
};

export const IncompatibleRemoteHost: Story = {
  render: () => (
    <OpenBotPlayground
      options={{
        servers: [
          { ...storyLocalServer, active: false },
          {
            ...storyRemoteServer,
            active: true,
            state: "incompatible",
            compatibility: {
              localAppVersion: "44.0.0",
              hostAppVersion: "42.0.0",
              localProtocol: { minimum: 2, maximum: 2 },
              hostProtocol: { minimum: 1, maximum: 1 },
              negotiatedProtocol: null,
              capabilities: [],
            },
            issue: {
              code: "host_update_required",
              message: "Update OpenBot on the host.",
              retryable: true,
            },
          },
        ],
      }}
    />
  ),
};

export const DifferentRemoteVersions: Story = {
  render: () => (
    <OpenBotPlayground
      options={{
        servers: [
          { ...storyLocalServer, active: false },
          {
            ...storyRemoteServer,
            active: true,
            compatibility: {
              localAppVersion: "44.0.0",
              hostAppVersion: "43.0.0",
              localProtocol: { minimum: 1, maximum: 1 },
              hostProtocol: { minimum: 1, maximum: 1 },
              negotiatedProtocol: 1,
              capabilities: [
                "agent-runtime-snapshots",
                "browser-control",
                "conversation-pagination",
                "direct-messages",
                "remote-desktop",
                "sidebar-layout",
              ],
            },
            connectionSequence: 1,
          },
        ],
      }}
    />
  ),
};

/** A joined server has a new OpenBot version. Entering it opens the update dialog each time. */
export const RemoteHostUpdate: Story = {
  render: () => (
    <OpenBotPlayground
      options={{
        servers: [
          storyLocalServer,
          {
            ...storyRemoteServer,
            active: false,
            compatibility: {
              localAppVersion: "0.24.0",
              hostAppVersion: "0.23.0",
              localProtocol: { minimum: 1, maximum: 1 },
              hostProtocol: { minimum: 1, maximum: 1 },
              negotiatedProtocol: 1,
              capabilities: ["host-admin-v1", "host-update-v1", "host-release-v1", "sidebar-layout"],
            },
            connectionSequence: 1,
          },
        ],
      }}
    />
  ),
};

export const Onboarding: Story = {
  render: () => (
    <OpenBotPlayground options={{ setupState: { completed: false, preferredProvider: null, preferredModel: null } }} />
  ),
};

export const SignedOut: Story = {
  render: () => <OpenBotPlayground options={{ authState: { status: "signed_out" } }} />,
};

export const AgentStarting: Story = {
  render: () => (
    <OpenBotPlayground
      options={{
        agentStatus: {
          ...STORY_AGENT_STATUS,
          phase: "starting",
          message: "Starting local agent CLIs…",
        },
        agents: STORY_AGENT_SUMMARIES.slice(0, 1),
      }}
    />
  ),
};

/**
 * The signed-out provider in the real shell. `sign-in-required` is the only input: the notice, the
 * model picker's label and the suppressed usage chip all read that one field.
 */
export const ProviderSignInRequired: Story = {
  render: () => (
    <OpenBotPlayground
      options={{
        agentStatus: {
          ...STORY_AGENT_STATUS,
          auth: { kind: "signed-out" },
          providers: STORY_AGENT_STATUS.providers?.map((provider) =>
            provider.id === "codex"
              ? {
                  ...provider,
                  state: "sign-in-required" as const,
                  email: null,
                  message: "Connect ChatGPT to continue.",
                }
              : provider,
          ),
        },
      }}
    />
  ),
};

/** One agent for each wait: a question, a command approval and a browser takeover. */
const STORY_WAITING_EVENTS: AgentEvent[] = [
  {
    type: "prompt",
    requestId: "story-question",
    agentId: "research",
    threadId: "thread-research",
    turnId: "turn-research-wait",
    questions: [
      {
        id: "region",
        header: "Region",
        question: "Which region should we launch in first?",
        isSecret: false,
        options: [
          { label: "EU", description: "Start with the EU store." },
          { label: "US", description: "Start with the US store." },
        ],
      },
    ],
  },
  {
    type: "approval",
    approval: {
      requestId: "story-approval",
      agentId: "chief",
      threadId: "thread-chief",
      turnId: "turn-chief-wait",
      kind: "command",
      command: "bun run release:publish",
      cwd: null,
      reason: null,
      grantRoot: null,
      permissions: null,
    },
  },
  {
    type: "browser-takeover-requested",
    request: {
      requestId: "story-takeover",
      agentId: "sales",
      threadId: "thread-sales",
      turnId: "turn-sales-wait",
      tabId: "story-tab",
    },
  },
];

/**
 * The "Needs you" group in the real shell. The waits arrive as agent events, so the sidebar reads
 * them through the same bridge as on desktop. Each subscriber gets them again, which is harmless:
 * a wait is kept per agent.
 */
function WaitingForInputPlayground(props: { compact: boolean }) {
  useStoredLayoutValue(LEFT_PANEL_COLLAPSED_STORAGE_KEY, props.compact ? "true" : "false");
  return (
    <OpenBotPlayground
      dependencies={{
        createMock: (options) => {
          const mock = createMockOpenBot(options);
          const subscribe = mock.api.agent.onEvent;
          mock.api.agent.onEvent = (listener) => {
            const unsubscribe = subscribe(listener);
            queueMicrotask(() => {
              for (const event of STORY_WAITING_EVENTS) mock.emitAgentEvent(event);
            });
            return unsubscribe;
          };
          return mock;
        },
        renderApp: () => <App />,
      }}
    />
  );
}

export const AgentsWaitingForInput: Story = {
  render: () => <WaitingForInputPlayground compact={false} />,
};

export const CompactAgentsWaitingForInput: Story = {
  render: () => <WaitingForInputPlayground compact />,
};

const TICKETS_STORY_TIME = "2026-10-28T09:00:00.000Z";

function storyTicket(
  ticket: Pick<BoardTicket, "id" | "title" | "status" | "agentId" | "order"> & Partial<BoardTicket>,
): BoardTicket {
  const statusTimes: BoardTicket["statusTimes"] = {};
  statusTimes[ticket.status] = TICKETS_STORY_TIME;
  return {
    body: "",
    taskId: null,
    threadId: null,
    teamJobId: null,
    teamRoleId: null,
    external: null,
    progress: null,
    error: null,
    statusTimes,
    statusChangedAt: TICKETS_STORY_TIME,
    createdAt: TICKETS_STORY_TIME,
    updatedAt: TICKETS_STORY_TIME,
    ...ticket,
  };
}

/** A work thread of Chief that runs a turn now. It stays running until Stop: the mock schedules no reply. */
const TICKETS_STORY_THREAD: AgentTask = {
  id: "story-ticket-task",
  agentId: "chief",
  threadId: "story-ticket-thread",
  origin: "user",
  title: "Fix the login timeout",
  state: "running",
  outcome: null,
  hold: null,
  activeTurnId: "story-ticket-turn",
  progress: "Reading the session code…",
  error: null,
  queuedMessages: [],
  createdAt: TICKETS_STORY_TIME,
  updatedAt: TICKETS_STORY_TIME,
  closedAt: null,
  pausedAt: null,
  workspace: {
    mode: "worktree",
    path: "~/OpenBot/Agents/chief/.openbot/worktrees/story-ticket-task",
    branch: "openbot/story-ticket-task",
  },
};

const TICKETS_STORY_OPTIONS: MockOpenBotOptions = {
  boardTickets: [
    storyTicket({
      id: "story-ticket-running",
      title: "Fix the login timeout",
      body: "Sessions end after 5 minutes. They should last 30.",
      status: "running",
      agentId: "chief",
      order: 1,
      taskId: TICKETS_STORY_THREAD.id,
      threadId: TICKETS_STORY_THREAD.threadId,
      external: {
        provider: "github",
        key: "OmarrGhorab/openbot-personal#155",
        url: "https://github.com/OmarrGhorab/openbot-personal/issues/155",
      },
    }),
    storyTicket({
      id: "story-ticket-backlog",
      title: "Write the release notes",
      status: "backlog",
      agentId: "research",
      order: 1,
    }),
    storyTicket({
      id: "story-ticket-unassigned",
      title: "Clean up old logs",
      status: "backlog",
      agentId: null,
      order: 2,
    }),
    storyTicket({
      id: "story-ticket-review",
      title: "Add a retry to the sync job",
      status: "needs_review",
      agentId: "sales",
      order: 1,
    }),
    storyTicket({
      id: "story-ticket-done",
      title: "Rename the settings tab",
      status: "done",
      agentId: "chief",
      order: 1,
    }),
  ],
  tasks: { chief: [TICKETS_STORY_THREAD] },
  taskConversations: {
    [TICKETS_STORY_THREAD.id]: {
      agentId: "chief",
      threadId: TICKETS_STORY_THREAD.threadId,
      activeTurnId: "story-ticket-turn",
      revision: 1,
      messages: [
        {
          id: "story-ticket-message",
          turnId: "story-ticket-turn",
          author: "user",
          source: "user",
          text: "Fix the login timeout",
          createdAt: TICKETS_STORY_TIME,
          status: "completed",
        },
      ],
    },
  },
};

/**
 * The Tickets page from the rail: a running work thread with its ticket and issue link, a ticket in
 * the other columns, and an unassigned one. `scripts/tickets-board-e2e.ts` drives this story.
 */
export const TicketsBoard: Story = {
  render: () => <OpenBotPlayground options={TICKETS_STORY_OPTIONS} />,
};
