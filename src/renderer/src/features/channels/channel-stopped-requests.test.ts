import type { ChannelTask } from "@openbot/contracts/ipc";
import { expect, it } from "vitest";
import { stoppedChannelRequests } from "./channel-conversation-rows";

// Failure mode (ticket 234): one message to three members that all failed made three rows, and each new
// message added three more, each with the same generic reason.
function task(id: string, requestMessageId: string, owner: string, error: string | null): ChannelTask {
  return {
    id,
    channelId: "c",
    parentTaskId: null,
    rootTaskId: id,
    ownerAgentId: owner,
    requestMessageId,
    instruction: "",
    attachmentDraftIds: [],
    expectedResult: "",
    sourceMessageIds: [],
    dependencies: [],
    resources: [],
    state: "failed",
    revision: 1,
    assignmentCount: 1,
    error,
  };
}

it("shows one row for each request message, with each member's run inside", () => {
  const requests = stoppedChannelRequests({
    channel: { archived: false },
    tasks: [
      task("a", "m1", "planner", "Rate limited"),
      task("b", "m1", "builder", "Provider not installed"),
      task("c", "m1", "reviewer", "Model error"),
      task("d", "m2", "planner", "Rate limited"),
    ],
  });
  expect(requests.map((group) => group.map((entry) => entry.id))).toEqual([["a", "b", "c"], ["d"]]);
});
