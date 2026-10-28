import { type DynamicRecord, isDynamicRecord } from "@openbot/contracts/runtime-values";
import { redactText } from "@openbot/logging";
import { bridgedToolName, getRecord, getString, type ThreadItem } from "../protocol";

/** The project-memory tools that save text. Their input is redacted before the store saves it. */
const SAVING_TOOLS = ["save_lesson", "learn_from_failure"] as const;

/** The fields in which a provider keeps the input of a tool call. */
const INPUT_FIELDS = ["arguments", "input", "rawInput"] as const;

/**
 * The fields that are redacted. The result is included: OpenCode's Code Mode result echoes the input of
 * each tool call that the code made (`result.metadata.toolCalls[].input`).
 */
const REDACTED_FIELDS = [...INPUT_FIELDS, "result", "rawOutput"] as const;

function isSavingTool(name: string | null): boolean {
  if (!name) return false;
  return SAVING_TOOLS.some((tool) => name === tool || name === `openbot_${tool}` || name === `mcp__openbot__${tool}`);
}

/** Code Mode input: the model writes code that calls OpenBot's tools, so the code holds the saved text. */
function codeCallsSavingTool(item: ThreadItem): boolean {
  return INPUT_FIELDS.some((field) => {
    const code = getString(getRecord(item, field), "code");
    return code !== null && SAVING_TOOLS.some((tool) => code.includes(tool));
  });
}

/**
 * Whether a provider history item is a call of a project-memory tool that saves text: a direct call
 * (Codex, Claude, ACP), a `tool_call` bridge call, or Code Mode code that calls one. An MCP call of
 * another server with the same tool name is not OpenBot's.
 */
function callsSavingTool(item: ThreadItem): boolean {
  const bridged = bridgedToolName(item);
  if (bridged) return SAVING_TOOLS.some((tool) => bridged === `openbot.${tool}`);
  if (item.type === "mcpToolCall") {
    return getString(item, "server") === "openbot" && isSavingTool(getString(item, "tool"));
  }
  if (item.type !== "dynamicToolCall" && item.type !== "toolCall") return false;
  return isSavingTool(getString(item, "tool") ?? getString(item, "name")) || codeCallsSavingTool(item);
}

/** Redacts every string inside a copied input, in place. Only strings change; the shape stays. */
function redactStrings(container: DynamicRecord | unknown[]): void {
  for (const [key, field] of Object.entries(container)) {
    if (typeof field === "string") Reflect.set(container, key, redactText(field));
    else if (Array.isArray(field) || isDynamicRecord(field)) redactStrings(field);
  }
}

/**
 * The item as the provider history keeps it. A project-memory tool redacts secrets before it saves an
 * entry; the model's own call input, and a result that echoes it, hold the same text, so those fields
 * are redacted the same way. Every other item, and every other field, is returned unchanged.
 */
export function redactProjectMemoryToolInput(item: ThreadItem): ThreadItem {
  if (!callsSavingTool(item)) return item;
  const redacted = structuredClone(item);
  for (const field of REDACTED_FIELDS) {
    const value = redacted[field];
    if (typeof value === "string") redacted[field] = redactText(value);
    else if (Array.isArray(value) || isDynamicRecord(value)) redactStrings(value);
  }
  return redacted;
}
