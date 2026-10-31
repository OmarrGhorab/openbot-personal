import type { ChannelMember, ChannelTask } from "@openbot/contracts/ipc";
import { Button, buttonVariants, DropdownMenu } from "@openbot/ui";
import { createSignal, For, Show } from "solid-js";
import { useText } from "../../text";

type StoppedTask = Pick<ChannelTask, "id" | "ownerAgentId" | "error">;

/**
 * The stopped runs of a channel, one row for each request message (ticket 234). The row names each member
 * whose run stopped with its own reason. Continue runs them again and shows that it is retrying until they
 * leave the list; a refused command shows its reason in the row.
 */
export function ChannelStoppedTasks(props: {
  /** One group for each request message: the stopped run of each member it addressed. */
  requests: StoppedTask[][];
  members: Pick<ChannelMember, "agentId">[];
  name: (agentId: string | null) => string;
  onResume: (taskId: string, recipientAgentId: string | null) => Promise<boolean>;
}) {
  const { t, sourceText } = useText();
  const [retrying, setRetrying] = createSignal<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = createSignal<ReadonlySet<string>>(new Set());
  const key = (group: StoppedTask[]) => group.map((task) => task.id).join(" ");

  async function run(group: StoppedTask[], recipientAgentId: string | null): Promise<void> {
    const id = key(group);
    setRetrying((current) => new Set([...current, id]));
    setFailed((current) => new Set([...current].filter((entry) => entry !== id)));
    const results = await Promise.all(group.map((task) => props.onResume(task.id, recipientAgentId)));
    setRetrying((current) => new Set([...current].filter((entry) => entry !== id)));
    if (results.some((sent) => !sent)) setFailed((current) => new Set([...current, id]));
  }

  return (
    <Show when={props.requests.length}>
      <div class="channel-paused-tasks">
        <For each={props.requests}>
          {(group) => (
            <section
              class="channel-paused-task"
              aria-label={t("channel.stoppedTask.label", {
                name: group.map((task) => props.name(task.ownerAgentId)).join(", "),
              })}
            >
              <ul class="channel-paused-task-runs">
                <For each={group}>
                  {(task) => (
                    <li class="channel-paused-task-reason">
                      <span class="channel-paused-task-name" dir="auto">
                        {props.name(task.ownerAgentId)}
                      </span>
                      <span dir="auto">{task.error ? sourceText(task.error) : null}</span>
                    </li>
                  )}
                </For>
              </ul>
              <Show when={failed().has(key(group))}>
                <p class="channel-paused-task-error" role="alert">
                  {t("channel.stoppedTask.commandFailed")}
                </p>
              </Show>
              <div class="channel-paused-task-actions">
                <Button
                  size="xs"
                  loading={retrying().has(key(group))}
                  loadingLabel={t("channel.stoppedTask.retrying")}
                  onClick={() => void run(group, null)}
                >
                  {t("common.continue")}
                </Button>
                <DropdownMenu.Root placement="top-start">
                  <DropdownMenu.Trigger
                    class={buttonVariants({ variant: "ghost", size: "xs" })}
                    aria-label={t("channel.stoppedTask.reassignLabel", {
                      name: group.map((task) => props.name(task.ownerAgentId)).join(", "),
                    })}
                  >
                    {t("channel.stoppedTask.reassign")}
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal>
                    <DropdownMenu.Content>
                      <For
                        each={props.members.filter(
                          (member) => !group.some((task) => task.ownerAgentId === member.agentId),
                        )}
                      >
                        {(member) => (
                          <DropdownMenu.Item onSelect={() => void run(group, member.agentId)}>
                            {props.name(member.agentId)}
                          </DropdownMenu.Item>
                        )}
                      </For>
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              </div>
            </section>
          )}
        </For>
      </div>
    </Show>
  );
}
