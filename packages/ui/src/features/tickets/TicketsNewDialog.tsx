import { type AgentTasksSnapshot, type BoardTicketType, detectBoardTicketType } from "@openbot/contracts/ipc";
import {
  Button,
  buttonVariants,
  Checkbox,
  Dialog,
  DropdownMenu,
  Field,
  Input,
  Play,
  SlidingTabs,
  Textarea,
} from "@openbot/ui";
import type { AgentProfile } from "@openbot/ui/data";
import { AgentAvatar } from "@openbot/ui/features/agents/AgentAvatar";
import { useText } from "@openbot/ui/text";
import { createSignal, createUniqueId, For, Show, untrack } from "solid-js";
import { TICKET_TYPE_LABEL } from "./TicketTypeChip";
import { runningThreads, type TicketStart } from "./tickets-model";

/** A ticket that the New ticket dialog adds to the backlog. */
export interface TicketNew {
  title: string;
  body: string;
  agentId: string | null;
  /** The person's choice of type. Absent: the board detects it from the title and the text. */
  type?: BoardTicketType;
  /** The repository or folder for the ticket's work (#257). Absent: the agent's folder. */
  workFolder?: string;
}

/**
 * The rule that Autopilot applies to a ticket of one type, as the person reads it in the New ticket
 * dialog: "Raven Stack · Autopilot (full) · Builder Opus 5.5 · Auto-merge off".
 */
interface TicketsAutopilotRule {
  /** The stack name, such as "Raven Stack". Null: Raven picks the stack for each ticket. */
  stack: string | null;
  /** The team or the playbook of the stack, such as "Autopilot (full)". Null when there is none. */
  setup: string | null;
  /** The model of the Builder, such as "Opus 5.5". Null when Raven picks it. */
  builder: string | null;
  /** The Reviewer merges a ticket of this type by itself. */
  autoMerge: boolean;
}

/** Autopilot while its switch is on. The consumer leaves it out when Autopilot is off. */
export interface TicketsAutopilot {
  /** The rule for a ticket of this type. Null: a ticket whose type is not known yet. */
  rule: (type: BoardTicketType | null) => TicketsAutopilotRule;
}

/** The Type field: Auto-detect, or the person's choice. */
type TypeChoice = BoardTicketType | "auto";
const TYPE_CHOICES = ["auto", "feature", "bug", "chore"] as const satisfies readonly TypeChoice[];

function isTypeChoice(value: string): value is TypeChoice {
  return TYPE_CHOICES.some((choice) => choice === value);
}

const UNASSIGNED = "";

/**
 * The New ticket dialog: Name, Details and Type (Auto-detect, Feature, Bug, Chore). With Autopilot on,
 * "Let autopilot work on it" shows the rule that applies, and Add ticket puts the ticket in Backlog for
 * Autopilot with no agent. Without it, the agent field stays: Add to backlog keeps the ticket for later,
 * and Start now starts its work thread with the agent. The agent of an open agent panel is chosen first.
 */
export function TicketsNewDialog(props: {
  agents: readonly AgentProfile[];
  snapshots: Readonly<Record<string, AgentTasksSnapshot>>;
  agentId: string | null;
  autopilot?: TicketsAutopilot | undefined;
  onClose: () => void;
  onCreate: (ticket: TicketNew) => Promise<boolean>;
  onStart: (start: TicketStart) => Promise<boolean>;
}) {
  const { t } = useText();
  const typeLabelId = createUniqueId();
  const autopilotId = createUniqueId();
  const [title, setTitle] = createSignal("");
  const [body, setBody] = createSignal("");
  const [folder, setFolder] = createSignal("");
  const [type, setType] = createSignal<TypeChoice>("auto");
  const [agentId, setAgentId] = createSignal<string | null>(untrack(() => props.agentId));
  // Autopilot takes the ticket by default, unless an agent panel chose an agent first.
  const [autopilotOn, setAutopilotOn] = createSignal(untrack(() => props.agentId === null));
  const [busy, setBusy] = createSignal<"add" | "start" | null>(null);
  const agent = () => props.agents.find((candidate) => candidate.id === agentId());
  const trimmed = () => title().trim();
  /** Autopilot works on the ticket: its switch is on and the person kept the option. */
  const byAutopilot = () => props.autopilot !== undefined && autopilotOn();
  const detected = () =>
    trimmed() || body().trim() ? detectBoardTicketType({ title: trimmed(), body: body().trim() }) : null;
  /** The type the ticket gets: the person's choice, or the detected one. */
  const effectiveType = () => {
    const choice = type();
    return choice === "auto" ? detected() : choice;
  };
  const freeThreads = (id: string) => {
    const snapshot = props.snapshots[id];
    return snapshot ? Math.max(0, snapshot.limit - runningThreads(snapshot)) : null;
  };
  const ruleLine = () => {
    const autopilot = props.autopilot;
    if (!autopilot) return "";
    const rule = autopilot.rule(effectiveType());
    return [
      rule.stack ?? t("tickets.new.autopilot.autoStack"),
      rule.setup,
      rule.builder ? t("tickets.new.autopilot.builder", { model: rule.builder }) : null,
      t(rule.autoMerge ? "tickets.new.autopilot.autoMergeOn" : "tickets.new.autopilot.autoMergeOff"),
    ]
      .filter((part): part is string => Boolean(part))
      .join(" · ");
  };
  const ruleLabel = () => {
    const current = effectiveType();
    return current
      ? t("tickets.new.autopilot.typeRule", { type: t(TICKET_TYPE_LABEL[current]) })
      : t("tickets.new.autopilot.rule");
  };

  async function submit(start: boolean): Promise<void> {
    const name = trimmed();
    const owner = byAutopilot() ? null : agentId();
    if (!name || busy() || (start && !owner)) return;
    const choice = type();
    const workFolder = folder().trim();
    const folderPart = workFolder ? { workFolder } : {};
    setBusy(start ? "start" : "add");
    const done =
      start && owner
        ? await props.onStart({
            agentId: owner,
            title: name,
            body: body().trim(),
            ...(choice === "auto" ? {} : { type: choice }),
            ...folderPart,
          })
        : await props.onCreate({
            title: name,
            body: body().trim(),
            agentId: owner,
            ...(choice === "auto" ? {} : { type: choice }),
            ...folderPart,
          });
    setBusy(null);
    if (done) props.onClose();
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
          <Dialog.Content class="tickets-new tickets-new-ticket" as="section">
            <header class="tickets-new-header">
              <Dialog.Title as="h2" class="tickets-new-title">
                {t("tickets.new")}
              </Dialog.Title>
              <Dialog.Description class="tickets-new-description">
                {props.autopilot ? t("tickets.new.descriptionAutopilot") : t("tickets.new.description")}
              </Dialog.Description>
            </header>
            <form
              class="tickets-new-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submit(false);
              }}
            >
              <div class="tickets-new-body">
                <Field label={t("tickets.new.name")} required>
                  <Input value={title()} disabled={busy() !== null} onValueChange={setTitle} />
                </Field>
                <Field label={t("tickets.new.details")}>
                  <Textarea
                    value={body()}
                    rows={4}
                    disabled={busy() !== null}
                    placeholder={t("tickets.new.detailsPlaceholder")}
                    onValueChange={setBody}
                  />
                </Field>
                <Field label={t("tickets.new.folder")}>
                  <Input
                    dir="ltr"
                    value={folder()}
                    disabled={busy() !== null}
                    spellcheck={false}
                    placeholder={agent()?.workFolder ?? t("tickets.new.folderPlaceholder")}
                    onValueChange={setFolder}
                  />
                </Field>
                <div class="tickets-new-field">
                  <span class="tickets-new-label" id={typeLabelId}>
                    {t("tickets.type.label")}
                  </span>
                  <SlidingTabs.Root
                    value={type()}
                    onChange={(value: string) => {
                      if (isTypeChoice(value)) setType(value);
                    }}
                  >
                    <SlidingTabs.List aria-labelledby={typeLabelId} class="tickets-new-types">
                      <For each={TYPE_CHOICES}>
                        {(choice) => (
                          <SlidingTabs.Trigger value={choice} disabled={busy() !== null}>
                            <Show
                              when={choice !== "auto" ? choice : undefined}
                              fallback={
                                <Show when={detected()} fallback={t("tickets.new.typeAuto")}>
                                  {(found) => (
                                    <span class="tickets-type" data-type={found()}>
                                      <span class="tickets-type-dot" aria-hidden="true" />
                                      {t("tickets.new.typeAutoDetected", { type: t(TICKET_TYPE_LABEL[found()]) })}
                                    </span>
                                  )}
                                </Show>
                              }
                            >
                              {(fixed) => (
                                <span class="tickets-type" data-type={fixed()}>
                                  <span class="tickets-type-dot" aria-hidden="true" />
                                  {t(TICKET_TYPE_LABEL[fixed()])}
                                </span>
                              )}
                            </Show>
                          </SlidingTabs.Trigger>
                        )}
                      </For>
                    </SlidingTabs.List>
                  </SlidingTabs.Root>
                  <p class="tickets-new-hint">
                    {props.autopilot ? t("tickets.new.typeHintAutopilot") : t("tickets.new.typeHint")}
                  </p>
                </div>

                <Show when={props.autopilot}>
                  <div class="tickets-new-autopilot" data-on={autopilotOn() ? "" : undefined}>
                    <Checkbox
                      id={autopilotId}
                      checked={autopilotOn()}
                      disabled={busy() !== null}
                      onChange={(event) => setAutopilotOn(event.currentTarget.checked)}
                    />
                    <label class="tickets-new-autopilot-text" for={autopilotId}>
                      <span class="tickets-new-autopilot-title">{t("tickets.new.autopilot.title")}</span>
                      <span class="tickets-new-autopilot-body">{t("tickets.new.autopilot.body")}</span>
                      <span class="tickets-new-autopilot-rule">
                        <span class="tickets-new-autopilot-rule-label">{ruleLabel()}</span>
                        <span class="tickets-new-autopilot-rule-value">{ruleLine()}</span>
                      </span>
                    </label>
                  </div>
                </Show>

                <Show when={!byAutopilot()}>
                  <div class="tickets-new-field">
                    <span class="tickets-new-label">{t("tickets.new.agent")}</span>
                    <DropdownMenu.Root placement="bottom-start" gutter={4}>
                      <DropdownMenu.Trigger
                        class={`${buttonVariants({ variant: "outline", size: "sm" })} tickets-drawer-agent`}
                        aria-label={t("tickets.new.agent")}
                        disabled={busy() !== null}
                      >
                        <Show when={agent()} fallback={t("tickets.card.unassigned")}>
                          {(owner) => (
                            <>
                              <AgentAvatar agent={owner()} class="tickets-drawer-avatar" />
                              {owner().name}
                            </>
                          )}
                        </Show>
                      </DropdownMenu.Trigger>
                      <DropdownMenu.Portal>
                        <DropdownMenu.Content class="tickets-new-menu">
                          <DropdownMenu.RadioGroup
                            value={agentId() ?? UNASSIGNED}
                            onChange={(value: string) => setAgentId(value === UNASSIGNED ? null : value)}
                          >
                            <DropdownMenu.RadioItem value={UNASSIGNED} closeOnSelect>
                              {t("tickets.card.unassigned")}
                            </DropdownMenu.RadioItem>
                            <For each={props.agents} keyed={(option) => option.id}>
                              {(option) => (
                                <DropdownMenu.RadioItem value={option().id} closeOnSelect class="tickets-drawer-agent">
                                  <AgentAvatar agent={option()} class="tickets-drawer-avatar" />
                                  <span class="tickets-new-agent-name" dir="auto">
                                    {option().name}
                                  </span>
                                  <Show when={freeThreads(option().id) !== null}>
                                    <span class="tickets-new-agent-free">
                                      {t("tickets.new.freeThreads", { count: freeThreads(option().id) ?? 0 })}
                                    </span>
                                  </Show>
                                </DropdownMenu.RadioItem>
                              )}
                            </For>
                          </DropdownMenu.RadioGroup>
                        </DropdownMenu.Content>
                      </DropdownMenu.Portal>
                    </DropdownMenu.Root>
                    <Show when={!agentId()}>
                      <p class="tickets-new-hint">{t("tickets.new.noAgent")}</p>
                    </Show>
                  </div>
                </Show>
              </div>
              <footer class="tickets-new-actions">
                <Button type="button" variant="outline" disabled={busy() !== null} onClick={props.onClose}>
                  {t("common.cancel")}
                </Button>
                <span class="tickets-new-spacer" />
                <Show
                  when={!byAutopilot()}
                  fallback={
                    <Button type="submit" loading={busy() === "add"} disabled={!trimmed() || busy() !== null}>
                      {t("tickets.new.addTicket")}
                    </Button>
                  }
                >
                  <Button
                    type="submit"
                    variant="outline"
                    loading={busy() === "add"}
                    disabled={!trimmed() || busy() !== null}
                  >
                    {t("tickets.new.add")}
                  </Button>
                  <Button
                    type="button"
                    loading={busy() === "start"}
                    disabled={!trimmed() || !agentId() || busy() !== null}
                    onClick={() => void submit(true)}
                  >
                    <Play aria-hidden="true" />
                    {t("tickets.new.start")}
                  </Button>
                </Show>
              </footer>
            </form>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
