import type { RavenTeamJob, RavenTeamTemplate } from "@openbot/contracts/ipc";
import { type RavenTeamModelChoice, RavenTeamPage } from "@openbot/ui/features/raven-team/RavenTeamPage";
import { createSignal, onSettled, Show } from "solid-js";

/**
 * The Raven Stack team page on desktop. A team runs on this computer, so every call goes to the local
 * team bridge. The page reads a job again when the bridge says it changed; it never polls.
 */
export function RavenTeamPanel(props: { serverId: string; onBack?: (() => void) | undefined }) {
  const [templates, setTemplates] = createSignal<RavenTeamTemplate[]>([]);
  const [jobs, setJobs] = createSignal<RavenTeamJob[]>([]);
  const [models, setModels] = createSignal<RavenTeamModelChoice[]>([]);
  const [loaded, setLoaded] = createSignal(false);

  const refreshJobs = () => window.openbot.ravenTeam.listJobs().then(setJobs);

  onSettled(() => {
    void Promise.all([
      window.openbot.ravenTeam.listTemplates(),
      window.openbot.ravenTeam.listJobs(),
      window.openbot.agent.listModels(props.serverId),
    ]).then(([nextTemplates, nextJobs, nextModels]) => {
      setTemplates(nextTemplates);
      setJobs(nextJobs);
      setModels(nextModels.map((model) => ({ id: model.id, name: model.name })));
      setLoaded(true);
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
        onBack={props.onBack}
      />
    </Show>
  );
}
