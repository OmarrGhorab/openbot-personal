import type { BoardTicketProvider } from "@openbot/contracts/ipc";
import { Link } from "@openbot/ui";
import { GitHubMark, JiraMark } from "@openbot/ui/features/settings/brand-marks";
import { Show } from "solid-js";

/** The mark of a ticket system. Linear has no sync yet, so it gets the plain link icon. */
export function TicketsProviderMark(props: { provider: BoardTicketProvider | null; class: string }) {
  return (
    <Show
      when={props.provider === "github"}
      fallback={
        <Show when={props.provider === "jira"} fallback={<Link aria-hidden="true" class={props.class} />}>
          <JiraMark class={props.class} />
        </Show>
      }
    >
      <GitHubMark class={props.class} />
    </Show>
  );
}
