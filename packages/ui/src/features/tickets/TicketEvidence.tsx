import {
  BOARD_TICKET_EVIDENCE_PHASES,
  type BoardTicketEvidence,
  type BoardTicketEvidencePhase,
} from "@openbot/contracts/ipc";
import { Button, Textarea } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createSignal, For, Show } from "solid-js";

export interface TicketEvidenceProps {
  evidence: readonly BoardTicketEvidence[];
  /** A screenshot as a data URL, for its thumbnail. */
  loadImage?: ((evidenceId: string) => Promise<string | null>) | undefined;
  /** Opens a screenshot or a recording full size. */
  onOpen?: ((evidenceId: string) => void) | undefined;
  /** Asks for a file and attaches it in this phase. Absent: the strip only shows. */
  onAttach?: ((phase: BoardTicketEvidencePhase) => Promise<void>) | undefined;
}

const PHASE_LABEL = {
  before: "tickets.evidence.before",
  after: "tickets.evidence.after",
  review: "tickets.evidence.review",
} as const;

const KIND_LABEL = {
  screenshot: "tickets.evidence.screenshot",
  recording: "tickets.evidence.recording",
  test_output: "tickets.evidence.testOutput",
  diff: "tickets.evidence.diff",
} as const;

/**
 * The Before / After / Review strip of a ticket (#236, #264): thumbnails for screenshots, a row for a
 * recording, and text blocks for test output and diffs. Code stays left to right in an RTL layout.
 */
export function TicketEvidence(props: TicketEvidenceProps) {
  const { t } = useText();
  const [phase, setPhase] = createSignal<BoardTicketEvidencePhase>("before");
  const [attaching, setAttaching] = createSignal(false);
  const inPhase = (value: BoardTicketEvidencePhase) => props.evidence.filter((item) => item.phase === value);

  return (
    <section class="ticket-drawer-section ticket-evidence" aria-label={t("tickets.evidence.title")}>
      <h4 class="ticket-drawer-heading">{t("tickets.evidence.title")}</h4>
      <Show when={props.evidence.length > 0} fallback={<p class="tickets-muted">{t("tickets.evidence.empty")}</p>}>
        <For each={BOARD_TICKET_EVIDENCE_PHASES.filter((value) => inPhase(value).length > 0)}>
          {(value) => (
            <div class="ticket-evidence-phase">
              <h5 class="ticket-evidence-phase-title">{t(PHASE_LABEL[value])}</h5>
              <ul class="ticket-evidence-list">
                <For each={inPhase(value)} keyed={(item) => item.id}>
                  {(item) => <EvidenceItem item={item()} loadImage={props.loadImage} onOpen={props.onOpen} />}
                </For>
              </ul>
            </div>
          )}
        </For>
      </Show>
      <Show when={props.onAttach}>
        {(attach) => (
          <div class="ticket-evidence-attach">
            <fieldset class="ticket-evidence-phases" aria-label={t("tickets.evidence.phase")}>
              <For each={BOARD_TICKET_EVIDENCE_PHASES}>
                {(value) => (
                  <Button
                    size="sm"
                    variant="ghost"
                    class="ticket-evidence-phase-option"
                    aria-pressed={phase() === value ? "true" : "false"}
                    onClick={() => setPhase(value)}
                  >
                    {t(PHASE_LABEL[value])}
                  </Button>
                )}
              </For>
            </fieldset>
            <Button
              size="sm"
              variant="outline"
              loading={attaching()}
              onClick={async () => {
                setAttaching(true);
                try {
                  await attach()(phase());
                } finally {
                  setAttaching(false);
                }
              }}
            >
              {t("tickets.evidence.attach")}
            </Button>
          </div>
        )}
      </Show>
    </section>
  );
}

function EvidenceItem(props: {
  item: BoardTicketEvidence;
  loadImage?: ((evidenceId: string) => Promise<string | null>) | undefined;
  onOpen?: ((evidenceId: string) => void) | undefined;
}) {
  const { t } = useText();
  const [image, setImage] = createSignal<string | null>(null);
  // One read per item: the list is keyed by id, so an item never changes its file.
  if (props.item.kind === "screenshot") {
    void props.loadImage?.(props.item.id).then(setImage, () => undefined);
  }
  const label = () => props.item.caption ?? props.item.fileName ?? t(KIND_LABEL[props.item.kind]);
  return (
    <li class="ticket-evidence-item" data-kind={props.item.kind}>
      <div class="ticket-evidence-meta">
        <span class="ticket-evidence-kind">{t(KIND_LABEL[props.item.kind])}</span>
        <span class="ticket-evidence-caption" title={label()}>
          {label()}
        </span>
      </div>
      <Show when={props.item.kind === "screenshot"}>
        <Button
          variant="ghost"
          class="ticket-evidence-thumb"
          aria-label={t("tickets.evidence.open", { name: label() })}
          onClick={() => props.onOpen?.(props.item.id)}
        >
          <Show when={image()} fallback={<span class="tickets-muted">{t("tickets.evidence.loading")}</span>}>
            {(src) => <img src={src()} alt={label()} />}
          </Show>
        </Button>
      </Show>
      <Show when={props.item.kind === "recording"}>
        <Button size="sm" variant="outline" onClick={() => props.onOpen?.(props.item.id)}>
          {t("tickets.evidence.play")}
        </Button>
      </Show>
      <Show when={props.item.text}>
        {(text) => (
          <pre class="ticket-evidence-text" dir="ltr" data-kind={props.item.kind}>
            {text()}
          </pre>
        )}
      </Show>
    </li>
  );
}

/** The person's comment box of a ticket's activity: the note goes to the ticket, not to the agent. */
export function TicketCommentBox(props: { onComment: (text: string) => Promise<boolean> }) {
  const { t } = useText();
  const [draft, setDraft] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  const save = async () => {
    const text = draft().trim();
    if (!text || saving()) return;
    setSaving(true);
    try {
      if (await props.onComment(text)) setDraft("");
    } finally {
      setSaving(false);
    }
  };
  return (
    <form
      class="ticket-comment-box"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <Textarea
        value={draft()}
        onValueChange={setDraft}
        rows={2}
        aria-label={t("tickets.comment.label")}
        placeholder={t("tickets.comment.placeholder")}
      />
      <Button type="submit" size="sm" loading={saving()} disabled={!draft().trim()}>
        {t("tickets.comment.add")}
      </Button>
    </form>
  );
}
