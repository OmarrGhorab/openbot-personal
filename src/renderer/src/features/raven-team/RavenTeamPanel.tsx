import {
  providerDisplayName,
  type RavenAutopilotSettings,
  type RavenTeamJob,
  type RavenTeamTemplate,
} from "@openbot/contracts/ipc";
import { RavenAutopilotPanel } from "@openbot/ui/features/raven-team/RavenAutopilotPanel";
import { type RavenTeamModelChoice, RavenTeamPage } from "@openbot/ui/features/raven-team/RavenTeamPage";
import { createSignal, onSettled, Show } from "solid-js";

/**
 * The Raven Stack team page on desktop. A team runs on this computer, so every call goes to the local
 * team bridge. The page reads a job again when the bridge says it changed; it never polls.
 */
export function RavenTeamPanel(props: {
  serverId: string;
  /** The team job to show first, when the Monitor opened the page on it. */
  jobId?: string | undefined;
  /** The ticket text that the page starts with, when a ticket of the board opened the page. */
  brief?: string | undefined;
  onBack?: (() => void) | undefined;
}) {
  const [templates, setTemplates] = createSignal<RavenTeamTemplate[]>([]);
  const [jobs, setJobs] = createSignal<RavenTeamJob[]>([]);
  const [models, setModels] = createSignal<RavenTeamModelChoice[]>([]);
  const [autopilot, setAutopilot] = createSignal<RavenAutopilotSettings | null>(null);
  const [loaded, setLoaded] = createSignal(false);

  const refreshJobs = () => window.openbot.ravenTeam.listJobs().then(setJobs);
  /**
   * Scrolls the page to a job, when the Monitor opened the page on it. The page names each job by the
   * first line of its ticket. A page that has no such job stays where it is.
   */
  const showJob = (job: RavenTeamJob) => {
    const name = job.brief.split("\n")[0] ?? "";
    const article = [...document.querySelectorAll<HTMLElement>(".raven-team-job[aria-label]")].find(
      (candidate) => candidate.getAttribute("aria-label") === name,
    );
    article?.scrollIntoView({ block: "nearest" });
  };

  onSettled(() => {
    void Promise.all([
      window.openbot.ravenTeam.listTemplates(),
      window.openbot.ravenTeam.listJobs(),
      window.openbot.agent.listModels(props.serverId),
      window.openbot.ravenAutopilot.get(),
    ]).then(([nextTemplates, nextJobs, nextModels, nextAutopilot]) => {
      setTemplates(nextTemplates);
      setAutopilot(nextAutopilot);
      setJobs(nextJobs);
      setModels(
        nextModels.map((model) => {
          const efforts = model.reasoningEffortConfigurable === false ? [] : [...model.supportedReasoningEfforts];
          return {
            id: model.id,
            name: model.name,
            provider: model.provider,
            providerName: providerDisplayName(model.provider),
            efforts,
            defaultEffort: efforts.length ? model.defaultReasoningEffort : null,
          };
        }),
      );
      setLoaded(true);
      const focus = nextJobs.find((job) => job.id === props.jobId);
      if (focus) requestAnimationFrame(() => showJob(focus));
    });
    const stopJobs = window.openbot.ravenTeam.onChanged(() => void refreshJobs());
    // Another window can change the Autopilot settings; main sends the saved settings to each one.
    const stopAutopilot = window.openbot.ravenAutopilot.onChanged(setAutopilot);
    // Solid runs the function that onSettled returns as its cleanup; onCleanup is not allowed here.
    return () => {
      stopJobs();
      stopAutopilot();
    };
  });

  /** The Autopilot tab, made once: its settings change in place, so a switch keeps its focus. */
  const autopilotPanel = (
    <Show when={autopilot()}>
      {(settings) => (
        <RavenAutopilotPanel
          settings={settings()}
          jobs={jobs()}
          models={models()}
          onChange={(next) => window.openbot.ravenAutopilot.set(next).then(setAutopilot)}
        />
      )}
    </Show>
  );

  return (
    <Show when={loaded()}>
      <RavenTeamPage
        templates={templates()}
        jobs={jobs()}
        models={models()}
        initialBrief={props.brief}
        initialTab={props.jobId ? "jobs" : "setup"}
        onPlan={(input) => window.openbot.ravenTeam.plan(input)}
        onStart={(input) => window.openbot.ravenTeam.start(input)}
        onStop={(jobId) => window.openbot.ravenTeam.stop(jobId)}
        onResume={(jobId) => window.openbot.ravenTeam.resume(jobId)}
        onSetRoleModel={(input) => window.openbot.ravenTeam.setRoleModel(input)}
        onGiveRoleFullAccess={(input) => window.openbot.ravenTeam.giveRoleFullAccess(input)}
        onBack={props.onBack}
        autopilot={autopilot() ? { on: autopilot()?.enabled ?? false, content: autopilotPanel } : undefined}
      />
    </Show>
  );
}
