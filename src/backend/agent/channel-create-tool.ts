import { randomUUID } from "node:crypto";
import { INPUT_LIMITS } from "@openbot/contracts/input-limits";
import type { AgentSummary, ChannelDraft } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import { z } from "zod";
import type { ChannelService } from "../channel-service";
import { openBotToolFailure, openBotToolResult } from "./routine-tools";
import { toolStep, toToolOperationFailed } from "./tool-operation";

const agentId = z.string().min(1).max(INPUT_LIMITS.identifier);

export const createChannelToolSchema = z
  .object({
    name: z.string().trim().min(1).max(INPUT_LIMITS.agentName),
    title: z.string().trim().max(INPUT_LIMITS.agentTitle).optional(),
    instructions: z.string().max(INPUT_LIMITS.agentDescription).optional(),
    memberAgentIds: z.array(agentId).max(INPUT_LIMITS.agents),
    leadAgentId: agentId.optional(),
  })
  .strict();

/**
 * Makes a new channel from a person's request, in a chat with the agent that calls it. The caller is
 * always a member and, unless the call names another member, the lead, so the channel can take requests
 * at once. Every member must be an agent that exists. The save goes through the channel service, as the
 * save of the channel settings does.
 */
export const handleCreateChannelTool = Effect.fn("ChannelCreateTool.handle")(function* (
  tool: string,
  args: unknown,
  channels: ChannelService,
  agents: readonly AgentSummary[],
  caller: AgentSummary,
) {
  if (tool !== "create_channel") return null;
  const input = yield* toolStep(() => createChannelToolSchema.parse(args));
  const memberIds = [...new Set([caller.id, ...input.memberAgentIds])];
  const unknown = memberIds.filter((id) => !agents.some((agent) => agent.id === id));
  if (unknown.length > 0)
    return openBotToolFailure(`No agent has the id ${unknown.join(", ")}. Get the ids from openbot.list_agents.`);
  const leadAgentId = input.leadAgentId ?? caller.id;
  if (!memberIds.includes(leadAgentId))
    return openBotToolFailure("The lead must be one of the members. Add it to memberAgentIds.");
  const draft: ChannelDraft = {
    name: input.name,
    title: input.title ?? "",
    instructions: input.instructions ?? "",
    members: memberIds.map((id) => ({ agentId: id })),
    leadAgentId,
  };
  const channel = yield* channels
    .command({ type: "save", operationId: randomUUID(), channelId: randomUUID(), draft }, caller)
    .pipe(toToolOperationFailed);
  if (!channel) return openBotToolFailure("The channel was not created.");
  return openBotToolResult({
    channelId: channel.id,
    name: channel.name,
    leadAgentId: channel.leadAgentId,
    members: channel.members.map((member) => ({
      agentId: member.agentId,
      name: agents.find((agent) => agent.id === member.agentId)?.name ?? member.agentId,
    })),
  });
});
