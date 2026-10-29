import { providerDisplayName, type RavenTeamJob, type RavenTeamTemplate } from "@openbot/contracts/ipc";
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
  onBack?: (() => void) | undefined;
}) {
  const [templates, setTemplates] = createSignal<RavenTeamTemplate[]>([]);
  const [jobs, setJobs] = createSignal<RavenTeamJob[]>([]);
  const [models, setModels] = createSignal<RavenTeamModelChoice[]>([]);
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
    ]).then(([nextTemplates, nextJobs, nextModels]) => {
      setTemplates(nextTemplates);
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
    // Solid runs the function that onSettled returns as its cleanup; onCleanup is not allowed here.
    return window.openbot.ravenTeam.onChanged(() => void refreshJobs());
  });

  return (
    <Show when={loaded()}>
      <RavenTeamPage
        templates={templates()}
        jobs={jobs()}
        models={models()}
        onPlan={(input) => window.openbot.ravenTeam.plan(input)}
        onStart={(input) => window.openbot.ravenTeam.start(input)}
        onStop={(jobId) => window.openbot.ravenTeam.stop(jobId)}
        onResume={(jobId) => window.openbot.ravenTeam.resume(jobId)}
        onSetRoleModel={(input) => window.openbot.ravenTeam.setRoleModel(input)}
        onGiveRoleFullAccess={(input) => window.openbot.ravenTeam.giveRoleFullAccess(input)}
        onBack={props.onBack}
      />
    </Show>
  );
}
