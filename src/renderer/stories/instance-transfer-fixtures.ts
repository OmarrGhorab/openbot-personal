import type {
  InstanceTransferAgent,
  InstanceTransferPreview,
  InstanceTransferResult,
  InstanceTransferSecretsSummary,
  InstanceTransferSummary,
} from "@openbot/contracts/ipc";
import { AGENT_IMPORT_PREVIEW } from "./agent-import-fixtures";

const MB = 1024 ** 2;
const GB = 1024 ** 3;

function transferAgent(
  id: string,
  name: string,
  title: string,
  counts: Omit<InstanceTransferAgent, "id" | "name" | "title" | "avatarSeed" | "avatarHue" | "avatarUrl">,
): InstanceTransferAgent {
  return { id, name, title, avatarSeed: id, avatarHue: null, avatarUrl: null, ...counts };
}

/** This computer, as `instanceTransfer.summary` answers it. */
export const INSTANCE_TRANSFER_SUMMARY: InstanceTransferSummary = {
  agents: [
    transferAgent("research", "Research", "Market research analyst", {
      skillCount: 4,
      routineCount: 2,
      memoryCount: 38,
      fileCount: 312,
      fileBytes: Math.round(184 * MB),
    }),
    transferAgent("inbox", "Inbox Triage", "Email assistant", {
      skillCount: 1,
      routineCount: 3,
      memoryCount: 12,
      fileCount: 0,
      fileBytes: 0,
    }),
    transferAgent("site", "Website Builder", "Landing pages and hosted sites", {
      skillCount: 6,
      routineCount: 0,
      memoryCount: 21,
      fileCount: 2_480,
      fileBytes: Math.round(0.9 * GB),
    }),
    transferAgent("finance", "Finance and Invoicing Assistant for the Kraków Office", "Monthly close and VAT reports", {
      skillCount: 3,
      routineCount: 4,
      memoryCount: 50,
      fileCount: 96,
      fileBytes: Math.round(22 * MB),
    }),
    transferAgent("devops", "DevOps", "Watches deploys and CI", {
      skillCount: 5,
      routineCount: 6,
      memoryCount: 29,
      fileCount: 640,
      fileBytes: Math.round(71 * MB),
    }),
  ],
};

/** A transfer file, as `instanceTransfer.choose` answers it. */
export const INSTANCE_TRANSFER_PREVIEW: InstanceTransferPreview = {
  token: "transfer-preview",
  appVersion: "0.9.4",
  exportedAt: "2026-10-12T18:20:00.000Z",
  agents: AGENT_IMPORT_PREVIEW.agents,
  hasSettings: true,
  warnings: [],
  migrationId: null,
};

/** The migration a copy or move records on the target, as the preview names it. */
export const INSTANCE_TRANSFER_MIGRATION_ID = "0f5d0f6e8c1a4f0b9d3c2e7a5b6c8d1e2f3a4b5c6d7e8f9012345678abcdef00";

/** A staged copy or move: the same file, with the target's migration id. */
export const INSTANCE_TRANSFER_COPY_PREVIEW: InstanceTransferPreview = {
  ...INSTANCE_TRANSFER_PREVIEW,
  token: "transfer-copy",
  migrationId: INSTANCE_TRANSFER_MIGRATION_ID,
};

export const INSTANCE_TRANSFER_WARNINGS = [
  'Research: the model "llama-4-70b" is not available here yet, so the agent uses the default model. Choose the model again when its provider is ready.',
  "GitHub: the MCP server is added turned off. Check its command, enter its values and full address again, and turn it on in MCP settings.",
];

export const INSTANCE_TRANSFER_RESULT: Omit<InstanceTransferResult, "agents"> = {
  skipped: [{ key: "sales", name: "Sales Outbound", reason: "SKILL.md must begin with YAML frontmatter." }],
  signIn: ["claude", "codex"],
  warnings: INSTANCE_TRANSFER_WARNINGS,
  migration: null,
};

/** What this computer holds, as `instanceTransfer.secrets` answers it: names, never values. */
export const INSTANCE_TRANSFER_SECRETS: InstanceTransferSecretsSummary = {
  items: [
    {
      id: "provider-key:claude",
      kind: "provider-key",
      label: "Claude Code",
      count: 1,
      section: "providers",
      transferable: true,
    },
    {
      id: "provider-key:codex",
      kind: "provider-key",
      label: "Codex",
      count: 1,
      section: "providers",
      transferable: true,
    },
    {
      id: "provider-sign-in:gemini",
      kind: "provider-sign-in",
      label: "Gemini",
      count: 1,
      section: "providers",
      transferable: false,
    },
    {
      id: "mcp-values:Linear",
      kind: "mcp-values",
      label: "Linear",
      count: 2,
      section: "mcp",
      transferable: true,
    },
    {
      id: "mcp-sign-in:https://mcp.notion.com/mcp",
      kind: "mcp-sign-in",
      label: "https://mcp.notion.com/mcp",
      count: 1,
      section: "mcp",
      transferable: false,
    },
    {
      id: "github",
      kind: "github",
      label: "GitHub",
      count: 1,
      section: "connectors",
      transferable: true,
    },
    {
      id: "bitwarden",
      kind: "bitwarden",
      label: "Bitwarden",
      count: 1,
      section: "connectors",
      transferable: false,
    },
  ],
};
