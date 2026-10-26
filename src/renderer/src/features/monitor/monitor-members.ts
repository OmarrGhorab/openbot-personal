import type { Channel, ChannelDraft } from "@openbot/contracts/ipc";
import type { ChannelsController } from "../channels/channels-controller";
import { toggleChannelMember } from "../channels/channels-draft";

/**
 * The draft of a channel with one member added or removed. It keeps the name, title, instructions
 * and lead of the channel, because a save writes the whole draft. The lead moves to a current
 * member when the lead leaves.
 */
function draftWithMember(channel: Channel, agentId: string, present: boolean): ChannelDraft {
  const draft: ChannelDraft = {
    name: channel.name,
    title: channel.title,
    instructions: channel.instructions,
    members: channel.members.map((member) => ({ agentId: member.agentId })),
    leadAgentId: channel.leadAgentId,
  };
  toggleChannelMember(draft, agentId, present);
  return draft;
}

/**
 * Adds or removes one agent of a channel through the channel command `save`, the same path the
 * channel settings use. The agent keeps its thread, workspace and identity; only its membership
 * changes. Resolves false when the host refuses the save.
 */
export async function changeChannelMember(
  channels: Pick<ChannelsController, "port" | "command">,
  channelId: string,
  agentId: string,
  present: boolean,
): Promise<boolean> {
  const page = await channels.port().agent.readChannel({ channelId });
  return channels.command({
    type: "save",
    operationId: crypto.randomUUID(),
    channelId,
    draft: draftWithMember(page.channel, agentId, present),
    update: true,
  });
}
