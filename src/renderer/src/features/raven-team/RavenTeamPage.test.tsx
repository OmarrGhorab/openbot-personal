import type { RavenTeamTemplate } from "@openbot/contracts/ipc";
import { type RavenTeamModelChoice, RavenTeamPage } from "@openbot/ui/features/raven-team/RavenTeamPage";

import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import { flush } from "solid-js";
import { expect, it, vi } from "vitest";
import { mockRavenTeam } from "../../preview/mock-raven-team";

// Failure modes: an empty ticket asks the host and shows its raw "brief is required."; a role shows a
// wall of model chips instead of provider, model and effort; a model with no effort levels offers
// efforts; a role that a ticket does not need cannot be left out.
const MODELS: RavenTeamModelChoice[] = [
  {
    id: "gpt-6-luna",
    name: "GPT-6 Luna",
    provider: "codex",
    providerName: "Codex",
    efforts: ["low", "medium", "high", "xhigh"],
    defaultEffort: "medium",
  },
  {
    id: "claude-sonnet-5-5",
    name: "Claude Sonnet 5.5",
    provider: "claude",
    providerName: "Claude",
    efforts: [],
    defaultEffort: null,
  },
];

async function page() {
  const team = mockRavenTeam();
  const templates: RavenTeamTemplate[] = await team.listTemplates();
  const onPlan = vi.fn(team.plan);
  const view = render(() => (
    <RavenTeamPage
      templates={templates}
      jobs={[]}
      models={MODELS}
      onPlan={onPlan}
      onStart={team.start}
      onStop={team.stop}
      onResume={team.resume}
      onSetRoleModel={team.setRoleModel}
      onGiveRoleFullAccess={team.giveRoleFullAccess}
    />
  ));
  flush();
  return { view, onPlan };
}

it("asks the host nothing for an empty ticket and says to write it first", async () => {
  const { view, onPlan } = await page();
  expect(view.container.textContent).toContain("Write the ticket to choose a model for each role.");
  expect(onPlan).not.toHaveBeenCalled();
});

it("checks the team as the ticket is written and shows provider, model and effort for each role", async () => {
  const { view } = await page();
  const ticket = view.container.querySelector("#raven-team-ticket");
  if (!ticket) throw new Error("no ticket box");
  fireEvent.input(ticket, {
    target: { value: "Ticket #42. Builder: gpt-6-luna. Reviewer: claude-sonnet-5-5." },
  });
  flush();
  /** A field of a role. Its accessible name also reads its value, so it is found by its own label. */
  const field = (label: string) => {
    const found = view.container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
    if (!found) throw new Error(`no field ${label}`);
    return found;
  };
  await waitFor(() => expect(field("Provider for Builder").textContent).toContain("Codex"));
  expect(field("Model for Builder").textContent).toContain("GPT-6 Luna");
  expect(field("Effort for Builder").textContent).toContain("Medium");
  // The Reviewer's model has no effort levels: the effort field is disabled and says so.
  const reviewerEffort = field("Effort for Reviewer");
  expect(reviewerEffort.textContent).toContain("No effort levels");
  expect(reviewerEffort.hasAttribute("disabled") || reviewerEffort.getAttribute("aria-disabled") === "true").toBe(true);
  // No wall of model chips: a role offers its model only through the model field.
  expect(view.queryAllByRole("button", { name: "Claude Sonnet 5.5" })).toHaveLength(0);
  expect(field("Provider for Reviewer").textContent).toContain("Claude");
});

it("leaves a role out of the job: the plan is asked again without it, and the Builder stays", async () => {
  const { view, onPlan } = await page();
  const ticket = view.container.querySelector("#raven-team-ticket");
  if (!ticket) throw new Error("no ticket box");
  fireEvent.input(ticket, { target: { value: "Fix a typo in the README." } });
  flush();
  await waitFor(() =>
    expect(view.container.textContent).toContain("4 on the team: Architect · Builder · Reviewer · Quality"),
  );
  // The Builder has no switch: its card says it is always on.
  expect(view.container.textContent).toContain("Always on");
  fireEvent.click(view.getByRole("switch", { name: "Architect" }));
  flush();
  await waitFor(() => expect(view.container.textContent).toContain("3 on the team: Builder · Reviewer · Quality"));
  expect(onPlan).toHaveBeenLastCalledWith(expect.objectContaining({ skippedRoles: ["architect"] }));
});
