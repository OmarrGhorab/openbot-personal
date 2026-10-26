import type { ConversationReactionActor, MessageReaction } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { MailboxStore } from "../mailbox-store";
import { StoredStateFailure } from "../stored-state-effects";
import { acknowledgeSteer, STEER_ACKNOWLEDGMENT } from "./queue-controls";

interface Reaction {
  agentId: string;
  messageId: string;
  actor: ConversationReactionActor;
  emoji: MessageReaction | null;
}

function reactionMailbox(fail = false): { mailbox: Pick<MailboxStore, "setReaction">; reactions: Reaction[] } {
  const reactions: Reaction[] = [];
  return {
    reactions,
    mailbox: {
      setReaction: (agentId, messageId, actor, emoji) => {
        if (fail) return Effect.fail(new StoredStateFailure({ cause: new Error("disk full") }));
        reactions.push({ agentId, messageId, actor, emoji });
        return Effect.void;
      },
    },
  };
}

describe("steer acknowledgment", () => {
  it("puts the agent's 👍 on the steered message", async () => {
    const { mailbox, reactions } = reactionMailbox();
    await Effect.runPromise(acknowledgeSteer(mailbox, "agent-1", "delivery-1"));
    expect(STEER_ACKNOWLEDGMENT).toBe("👍");
    expect(reactions).toEqual([
      { agentId: "agent-1", messageId: "delivery-1", actor: { kind: "agent", agentId: "agent-1" }, emoji: "👍" },
    ]);
  });

  it("does not turn a steer that happened into a failure when the reaction cannot be saved", async () => {
    const { mailbox, reactions } = reactionMailbox(true);
    const exit = await Effect.runPromiseExit(acknowledgeSteer(mailbox, "agent-1", "delivery-1"));
    expect(exit._tag).toBe("Success");
    expect(reactions).toEqual([]);
  });
});
