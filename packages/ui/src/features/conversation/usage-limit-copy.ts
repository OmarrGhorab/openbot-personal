// Which text the usage-limit card shows. A pure function, so the E2E check can test the card's choice
// without rendering it.

export type UsageLimitAskBodyKey =
  | "chat.usageLimit.noBackup"
  | "chat.usageLimit.exhaustedReset"
  | "chat.usageLimit.exhausted"
  | "chat.usageLimit.bodyReset"
  | "chat.usageLimit.body";

export interface UsageLimitAskBodyInput {
  /** The models that can take the message now. */
  optionCount: number;
  /** Whether the agent has a backup model set. */
  hasBackup: boolean;
  /** Whether the provider named when the limit resets. */
  hasReset: boolean;
}

/** The text of the usage-limit card for a held message. */
export function usageLimitAskBodyKey({
  optionCount,
  hasBackup,
  hasReset,
}: UsageLimitAskBodyInput): UsageLimitAskBodyKey {
  if (optionCount === 0) {
    if (!hasBackup) return "chat.usageLimit.noBackup";
    return hasReset ? "chat.usageLimit.exhaustedReset" : "chat.usageLimit.exhausted";
  }
  return hasReset ? "chat.usageLimit.bodyReset" : "chat.usageLimit.body";
}
