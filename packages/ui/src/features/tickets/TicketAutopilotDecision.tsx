import type { RavenAutopilotDecision, RavenAutopilotMergeBlock } from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import { Sparkles } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { For, Show } from "solid-js";
import { TicketTypeChip } from "./TicketTypeChip";

const LITE_TEMPLATE_ID = "raven-stack-lite";

/** Why the Reviewer did not merge (#198): the same sentence as the note on the ticket. */
const MERGE_BLOCK_TEXT = {
  "new-commit": "error.agent.autopilot.mergeBlocked.newCommit",
  "ci-failing": "error.agent.autopilot.mergeBlocked.ciFailing",
  "ci-missing": "error.agent.autopilot.mergeBlocked.ciMissing",
  "ci-timeout": "error.agent.autopilot.mergeBlocked.ciTimeout",
  "no-pull-request": "error.agent.autopilot.mergeBlocked.noPullRequest",
  "pull-request-closed": "error.agent.autopilot.mergeBlocked.pullRequestClosed",
  "not-connected": "error.agent.autopilot.mergeBlocked.notConnected",
  refused: "error.agent.autopilot.mergeBlocked.refused",
} as const satisfies Record<RavenAutopilotMergeBlock, AppTextKey>;

/**
 * The stack of a decision as one short label: "pstack · tdd" (#197), "Raven Stack · Autopilot lite" or
 * "Raven Stack · Autopilot (full)". The ticket card's live pill and the drawer show it.
 */
export function TicketStackPill(props: { decision: RavenAutopilotDecision; class?: string }) {
  const { t } = useText();
  const label = () => {
    const decision = props.decision;
    if (decision.stack === "pstack") {
      return decision.playbook ? t("tickets.autopilot.stackPlaybook", { playbook: decision.playbook }) : "pstack";
    }
    return decision.templateId === LITE_TEMPLATE_ID
      ? t("tickets.autopilot.stackLite")
      : t("tickets.autopilot.stackFull");
  };
  return (
    <span class={props.class ?? "tickets-decision-stack"}>
      <Sparkles aria-hidden="true" />
      {label()}
    </span>
  );
}

/**
 * Why Autopilot (#196) started this ticket the way it did: the type, the stack and its team, the model of
 * each role, and the reason in one or two sentences. Each language shows the sentence of the reason code;
 * a decision from an older build has no code and shows the English sentence it kept. A change of model or
 * stack after a failed round is listed under it.
 */
export function TicketAutopilotDecision(props: { decision: RavenAutopilotDecision }) {
  const { t } = useText();
  const reason = () => {
    const decision = props.decision;
    switch (decision.reasonCode) {
      case "feature-large":
        return typeof decision.files === "number" && decision.files > 0
          ? t("error.agent.autopilot.reason.featureFiles", { count: decision.files })
          : t("error.agent.autopilot.reason.featureLarge");
      case "feature-small":
        return t("error.agent.autopilot.reason.featureSmall");
      case "bug-failing-case":
        return t("error.agent.autopilot.reason.bugFailingCase");
      case "bug-investigate":
        return t("error.agent.autopilot.reason.bugInvestigate");
      case "chore-small":
        return t("error.agent.autopilot.reason.choreSmall");
      case "override":
        return t("error.agent.autopilot.reason.override");
      case "manual-stack":
        return t("error.agent.autopilot.reason.manualStack");
      case "pstack-missing":
        return t("error.agent.autopilot.reason.pstackMissing");
      default:
        return decision.reason;
    }
  };
  const roleLabel = (roleId: string) => props.decision.roles.find((role) => role.roleId === roleId)?.label ?? roleId;
  return (
    <section class="tickets-section">
      <h4>{t("tickets.autopilot.title")}</h4>
      <div class="tickets-decision">
        <div class="tickets-decision-top">
          <TicketTypeChip type={props.decision.ticketType} />
          <TicketStackPill decision={props.decision} />
          <Show when={props.decision.source === "override"}>
            <span class="tickets-decision-source">{t("tickets.autopilot.override")}</span>
          </Show>
        </div>
        <Show when={props.decision.roles.length > 0}>
          <ul class="tickets-decision-models" aria-label={t("tickets.autopilot.models")}>
            <For each={props.decision.roles} keyed={(role) => role.roleId}>
              {(role) => (
                <li class="tickets-decision-model" title={role().label}>
                  <span class="tickets-decision-role">{role().label}</span>
                  {role().model}
                </li>
              )}
            </For>
          </ul>
        </Show>
        <p class="tickets-decision-reason">{reason()}</p>
        <Show when={props.decision.merge}>
          {(merge) => (
            <p class={merge().state === "merged" ? "tickets-decision-merged" : "tickets-decision-reason"}>
              {merge().state === "merged"
                ? t("tickets.autopilot.merged", { method: merge().method })
                : t(MERGE_BLOCK_TEXT[merge().reason ?? "refused"])}
            </p>
          )}
        </Show>
        <Show when={(props.decision.switches ?? []).length > 0}>
          <ul class="tickets-decision-switches">
            <For each={props.decision.switches ?? []}>
              {(change) => (
                <li>
                  {change.kind === "stack"
                    ? t("tickets.autopilot.switchStack", {
                        round: change.round,
                        from: change.from,
                        to: change.to,
                      })
                    : t("tickets.autopilot.switchModel", {
                        round: change.round,
                        role: roleLabel(change.roleId),
                        from: change.from,
                        to: change.to,
                      })}
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>
    </section>
  );
}
