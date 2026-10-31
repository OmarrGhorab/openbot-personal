import type { AppTextKey } from "@openbot/i18n";
import { Bot, Button, Plus, RefreshCw, SquareCheck } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createSignal, createUniqueId, For, Show } from "solid-js";
import type { TicketNew } from "./TicketsNewDialog";

/** An example ticket of the empty board. Its texts are keys, so it is added in the person's language. */
interface TicketExample {
  id: string;
  /** The kind of agent that would take it, as the person reads it. The ticket itself has no agent. */
  role: AppTextKey;
  title: AppTextKey;
  body: AppTextKey;
}

const TICKET_EXAMPLES = [
  {
    id: "bug",
    role: "tickets.emptyState.example.bug.role",
    title: "tickets.emptyState.example.bug.title",
    body: "tickets.emptyState.example.bug.body",
  },
  {
    id: "changes",
    role: "tickets.emptyState.example.changes.role",
    title: "tickets.emptyState.example.changes.title",
    body: "tickets.emptyState.example.changes.body",
  },
  {
    id: "review",
    role: "tickets.emptyState.example.review.role",
    title: "tickets.emptyState.example.review.title",
    body: "tickets.emptyState.example.review.body",
  },
] as const satisfies readonly TicketExample[];

/**
 * The empty board: what a ticket is in two lines, Sync (New ticket is in the page header, once), and three example tickets. Each
 * example's Add to backlog adds that one ticket to Backlog with no agent, and the board takes over. The
 * page shows it only once the first ticket list has arrived empty, so it does not flash while the board
 * loads. `syncLabel` is null while no ticket system is connected: there is no Sync button then.
 */
export function TicketsEmptyState(props: {
  syncLabel: string | null;
  onSync: () => void;
  onCreate: (ticket: TicketNew) => Promise<boolean>;
}) {
  const { t } = useText();
  const headingId = createUniqueId();
  const examplesId = createUniqueId();
  /** The example being added. Every Add to backlog waits for it, so a double click adds one ticket. */
  const [adding, setAdding] = createSignal<string | null>(null);

  const add = async (example: TicketExample) => {
    if (adding() !== null) return;
    setAdding(example.id);
    try {
      await props.onCreate({ title: t(example.title), body: t(example.body), agentId: null });
    } finally {
      setAdding(null);
    }
  };

  return (
    <section class="tickets-empty" aria-labelledby={headingId}>
      <div class="tickets-empty-hero">
        <span class="tickets-empty-icon" aria-hidden="true">
          <SquareCheck />
        </span>
        <h3 id={headingId}>{t("tickets.emptyState.title")}</h3>
        <p class="tickets-empty-body">
          {t("tickets.empty.body")}
          <br />
          {t("tickets.emptyState.bodyMore")}
        </p>
        <div class="tickets-empty-actions">
          <Show when={props.syncLabel}>
            {(label) => (
              <Button variant="outline" onClick={() => props.onSync()}>
                <RefreshCw aria-hidden="true" />
                {label()}
              </Button>
            )}
          </Show>
        </div>
      </div>
      <div class="tickets-empty-examples">
        <h4 id={examplesId} class="tickets-empty-examples-title">
          {t("tickets.emptyState.examples")}
        </h4>
        <ul class="tickets-empty-example-list" aria-labelledby={examplesId}>
          <For each={TICKET_EXAMPLES}>
            {(example) => (
              <li class="tickets-empty-example">
                <span class="tickets-empty-example-role">
                  <Bot aria-hidden="true" />
                  {t(example.role)}
                </span>
                <span class="tickets-empty-example-title">{t(example.title)}</span>
                <span class="tickets-empty-example-body">{t(example.body)}</span>
                <Button
                  variant="link"
                  size="sm"
                  class="tickets-empty-example-add"
                  aria-label={t("tickets.emptyState.addLabel", { title: t(example.title) })}
                  disabled={adding() !== null}
                  onClick={() => void add(example)}
                >
                  <Plus aria-hidden="true" />
                  {t("tickets.emptyState.add")}
                </Button>
              </li>
            )}
          </For>
        </ul>
      </div>
    </section>
  );
}
