// Chat history in an instance transfer: `agents/<key>/conversations.json`, one file per exported agent.
// Every thread lands on the other computer as read-only history. No queued turn, routine, pending tool
// call, delivery, or question prompt is carried, and attachment bytes are not copied yet, so an
// attachment is listed as not copied and its message imports without it.

import { createHash } from "node:crypto";
import {
  type ConversationMessage,
  type ConversationMessageAuthor,
  isConversationMessage,
} from "@openbot/contracts/ipc";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";

export const CONVERSATIONS_FILE = "conversations.json";
const CONVERSATIONS_FORMAT = "openbot-conversations";
const CONVERSATIONS_VERSION = 1;

const AUTHORS: readonly ConversationMessageAuthor[] = ["user", "assistant", "agent", "system"];
const SOURCES: readonly NonNullable<ConversationMessage["source"]>[] = [
  "user",
  "assistant",
  "agent",
  "system",
  "routine",
];
const STATUSES = ["completed", "failed", "interrupted"] as const;
const TITLE_LIMIT = 512;
const TEXT_LIMIT = 1_000_000;

/** A conversation as the local database holds it, before it is written to the file. */
export interface ConversationSource {
  threadId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ConversationMessage[];
}

/** A message in the file: what a reader needs to show it, and nothing that acts. */
interface TransferMessage {
  id: string;
  author: ConversationMessageAuthor;
  text: string;
  createdAt: string;
  status: (typeof STATUSES)[number];
  itemType?: string;
  source?: NonNullable<ConversationMessage["source"]>;
  /** The key of an agent in the same file. A sender outside the file is not kept. */
  senderAgentKey?: string;
  replyToMessageId?: string | null;
  attachments?: TransferAttachment[];
}

interface TransferAttachment {
  name: string;
  size: number;
  mimeType: string;
  kind: string;
}

export interface TransferThread {
  threadId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: TransferMessage[];
}

export interface DecodedConversations {
  threads: TransferThread[];
  warnings: string[];
}

/** The file for one agent. `keyOf` gives a sender's key when that agent is in the same export. */
export function encodeConversations(
  threads: readonly ConversationSource[],
  keyOf: (agentId: string) => string | null,
): Uint8Array {
  const file = {
    format: CONVERSATIONS_FORMAT,
    version: CONVERSATIONS_VERSION,
    threads: threads.map((thread) => ({
      threadId: thread.threadId,
      title: thread.title,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      messages: thread.messages.map((message) => toTransferMessage(message, keyOf)),
    })),
  };
  return new TextEncoder().encode(JSON.stringify(file));
}

function toTransferMessage(message: ConversationMessage, keyOf: (agentId: string) => string | null): TransferMessage {
  const senderAgentKey = message.senderAgentId ? keyOf(message.senderAgentId) : null;
  return {
    id: message.id,
    author: message.author,
    text: message.text,
    createdAt: message.createdAt,
    status: message.status === "streaming" ? "interrupted" : message.status,
    ...(message.itemType ? { itemType: message.itemType } : {}),
    ...(message.source ? { source: message.source } : {}),
    ...(senderAgentKey ? { senderAgentKey } : {}),
    ...(message.replyToMessageId !== undefined ? { replyToMessageId: message.replyToMessageId } : {}),
    ...(message.attachments?.length
      ? {
          attachments: message.attachments.map(({ name, size, mimeType, kind }) => ({ name, size, mimeType, kind })),
        }
      : {}),
  };
}

/**
 * Reads a file written by `encodeConversations`. A file that is not one of ours yields no threads and one
 * warning. A thread or a message that does not decode is skipped, and the rest of the file still imports.
 */
export function decodeConversations(bytes: Uint8Array, agentName: string): DecodedConversations {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return unreadable(agentName);
  }
  if (
    !isDynamicRecord(value) ||
    value.format !== CONVERSATIONS_FORMAT ||
    value.version !== CONVERSATIONS_VERSION ||
    !Array.isArray(value.threads)
  )
    return unreadable(agentName);

  const threads: TransferThread[] = [];
  const warnings: string[] = [];
  for (const item of value.threads) {
    const thread = decodeThread(item);
    if (!thread) {
      warnings.push(sourceText("error.import.historyThreadSkipped", { name: agentName }));
      continue;
    }
    if (thread.skipped > 0) warnings.push(sourceText("error.import.historyMessagesSkipped", { name: agentName }));
    threads.push(thread.thread);
  }
  return { threads, warnings };
}

function unreadable(agentName: string): DecodedConversations {
  return { threads: [], warnings: [sourceText("error.import.historyFileInvalid", { name: agentName })] };
}

function decodeThread(value: unknown): { thread: TransferThread; skipped: number } | null {
  if (
    !isDynamicRecord(value) ||
    !isBoundedText(value.threadId, 256) ||
    !isBoundedText(value.title, TITLE_LIMIT) ||
    !isTimestamp(value.createdAt) ||
    !isTimestamp(value.updatedAt) ||
    !Array.isArray(value.messages)
  )
    return null;
  const messages: TransferMessage[] = [];
  let skipped = 0;
  for (const item of value.messages) {
    const message = decodeMessage(item);
    if (message) messages.push(message);
    else skipped += 1;
  }
  return {
    thread: {
      threadId: value.threadId,
      title: value.title,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
      messages,
    },
    skipped,
  };
}

function decodeMessage(value: unknown): TransferMessage | null {
  if (
    !isDynamicRecord(value) ||
    !isBoundedText(value.id, 512) ||
    !oneOf(AUTHORS, value.author) ||
    typeof value.text !== "string" ||
    value.text.length > TEXT_LIMIT ||
    !isTimestamp(value.createdAt) ||
    !oneOf(STATUSES, value.status)
  )
    return null;
  const attachments = decodeAttachments(value.attachments);
  if (attachments === null) return null;
  return {
    id: value.id,
    author: value.author,
    text: value.text,
    createdAt: value.createdAt,
    status: value.status,
    ...(typeof value.itemType === "string" && value.itemType.length <= 256 ? { itemType: value.itemType } : {}),
    ...(oneOf(SOURCES, value.source) ? { source: value.source } : {}),
    ...(isBoundedText(value.senderAgentKey, 512) ? { senderAgentKey: value.senderAgentKey } : {}),
    ...(typeof value.replyToMessageId === "string" || value.replyToMessageId === null
      ? { replyToMessageId: value.replyToMessageId }
      : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
  };
}

/** `null` when the field is malformed; an empty list when it is absent. */
function decodeAttachments(value: unknown): TransferAttachment[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const attachments: TransferAttachment[] = [];
  for (const item of value) {
    if (
      !isDynamicRecord(item) ||
      !isBoundedText(item.name, 512) ||
      typeof item.size !== "number" ||
      typeof item.mimeType !== "string" ||
      typeof item.kind !== "string"
    )
      return null;
    attachments.push({ name: item.name, size: item.size, mimeType: item.mimeType, kind: item.kind });
  }
  return attachments;
}

/**
 * The thread id an import writes. It depends on the target agent, so an import into the same agent again
 * writes the same thread, and the write only adds or removes messages.
 */
export function importedThreadId(targetAgentId: string, sourceKey: string, sourceThreadId: string): string {
  const digest = createHash("sha256")
    .update(JSON.stringify([targetAgentId, sourceKey, sourceThreadId]))
    .digest("hex");
  return `history-${digest.slice(0, 40)}`;
}

/**
 * The messages of a thread as the local database stores them. A message keeps its id, order and time. The
 * sender is kept only when it is the agent this thread came from. An attachment is listed as not copied.
 */
export function importedMessages(
  thread: TransferThread,
  sourceKey: string,
  targetAgentId: string,
  agentName: string,
  warnings: string[],
): ConversationMessage[] {
  const messages: ConversationMessage[] = [];
  for (const message of thread.messages) {
    for (const attachment of message.attachments ?? []) {
      warnings.push(sourceText("error.import.historyAttachmentNotCopied", { attachment: attachment.name }));
    }
    const converted: ConversationMessage = {
      id: message.id,
      author: message.author,
      text: message.text,
      createdAt: message.createdAt,
      status: message.status,
      ...(message.itemType ? { itemType: message.itemType } : {}),
      ...(message.source ? { source: message.source } : {}),
      ...(message.senderAgentKey === sourceKey ? { senderAgentId: targetAgentId } : {}),
      ...(message.replyToMessageId !== undefined ? { replyToMessageId: message.replyToMessageId } : {}),
    };
    if (isConversationMessage(converted)) messages.push(converted);
    else warnings.push(sourceText("error.import.historyMessagesSkipped", { name: agentName }));
  }
  return messages;
}

function oneOf<const T extends string>(options: readonly T[], value: unknown): value is T {
  return options.some((option) => option === value);
}

function isBoundedText(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= limit;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && !Number.isNaN(Date.parse(value));
}
