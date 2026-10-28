import {
  isRavenTeamChanged,
  isRavenTeamJob,
  isRavenTeamPlan,
  isRavenTeamTemplate,
  type RavenTeamChanged,
  type RavenTeamJob,
  type RavenTeamPlan,
  type RavenTeamTemplate,
} from "@openbot/contracts/ipc";

export function decodeRavenTemplates(value: unknown): RavenTeamTemplate[] {
  if (!Array.isArray(value) || !value.every(isRavenTeamTemplate)) throw new Error("Invalid team template response.");
  return value;
}

export function decodeRavenPlan(value: unknown): RavenTeamPlan {
  if (!isRavenTeamPlan(value)) throw new Error("Invalid team plan response.");
  return value;
}

export function decodeRavenJob(value: unknown): RavenTeamJob {
  if (!isRavenTeamJob(value)) throw new Error("Invalid team job response.");
  return value;
}

export function decodeRavenJobs(value: unknown): RavenTeamJob[] {
  if (!Array.isArray(value) || !value.every(isRavenTeamJob)) throw new Error("Invalid team jobs response.");
  return value;
}

export function decodeRavenChanged(value: unknown): RavenTeamChanged {
  if (!isRavenTeamChanged(value)) throw new Error("Invalid team change event.");
  return value;
}
