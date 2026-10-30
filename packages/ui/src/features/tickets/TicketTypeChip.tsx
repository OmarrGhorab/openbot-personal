import type { BoardTicketType } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { useText } from "@openbot/ui/text";
import { Show } from "solid-js";

/** The name of each ticket type. */
export const TICKET_TYPE_LABEL = {
  feature: "tickets.type.feature",
  bug: "tickets.type.bug",
  chore: "tickets.type.chore",
} as const satisfies Record<BoardTicketType, AppTextKey>;

/**
 * The type chip of a ticket: a dot in the colour of the type and its name. A ticket with no type yet shows
 * no chip, unless `unset` asks for the "No type" chip (the drawer's picker).
 */
export function TicketTypeChip(props: { type: BoardTicketType | null; unset?: boolean }) {
  const { t } = useText();
  return (
    <Show
      when={props.type}
      fallback={
        <Show when={props.unset}>
          <span class="tickets-type" data-type="unset">
            <span class="tickets-type-dot" aria-hidden="true" />
            {t("tickets.type.unset")}
          </span>
        </Show>
      }
    >
      {(type) => (
        <span class="tickets-type" data-type={type()}>
          <span class="tickets-type-dot" aria-hidden="true" />
          {t(TICKET_TYPE_LABEL[type()])}
        </span>
      )}
    </Show>
  );
}
