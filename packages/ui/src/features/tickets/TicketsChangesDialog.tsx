import type { BoardTicket } from "@openbot/contracts/ipc";
import { Button, Dialog, Field, Textarea } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createSignal } from "solid-js";

/**
 * The Changes button of a card that waits for review: the person writes what to change, and the text
 * goes to the ticket's work thread. The new turn moves the ticket back to Running, as any turn does.
 */
export function TicketsChangesDialog(props: {
  ticket: BoardTicket;
  onClose: () => void;
  /** Sends the text to the ticket's work thread. True when it went out. */
  onSend: (text: string) => Promise<boolean>;
}) {
  const { t } = useText();
  const [text, setText] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const trimmed = () => text().trim();

  async function submit(): Promise<void> {
    const value = trimmed();
    if (!value || busy()) return;
    setBusy(true);
    const sent = await props.onSend(value);
    setBusy(false);
    if (sent) props.onClose();
  }

  return (
    <Dialog.Root
      open={true}
      onOpenChange={(open) => {
        if (!open && !busy()) props.onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay>
          <Dialog.Content class="tickets-new" as="section">
            <header class="tickets-new-header">
              <Dialog.Title as="h2" class="tickets-new-title">
                {t("tickets.changes.title")}
              </Dialog.Title>
              <Dialog.Description class="tickets-muted">{t("tickets.changes.description")}</Dialog.Description>
            </header>
            <form
              class="tickets-new-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <Field label={props.ticket.title} required>
                <Textarea
                  value={text()}
                  rows={4}
                  disabled={busy()}
                  placeholder={t("tickets.changes.placeholder")}
                  onValueChange={setText}
                />
              </Field>
              <footer class="tickets-new-actions">
                <Button type="button" variant="ghost" disabled={busy()} onClick={props.onClose}>
                  {t("common.cancel")}
                </Button>
                <Button type="submit" loading={busy()} disabled={!trimmed() || busy()}>
                  {t("tickets.changes.send")}
                </Button>
              </footer>
            </form>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
