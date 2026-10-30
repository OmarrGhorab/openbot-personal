import {
  isRavenAutopilotSettings,
  isRavenTeamChanged,
  isRavenTeamJob,
  isRavenTeamPlan,
  isRavenTeamTemplate,
  isRavenTicketTakeResult,
  type RavenAutopilotSettings,
  type RavenTeamChanged,
  type RavenTeamJob,
  type RavenTeamPlan,
  type RavenTeamTemplate,
  type RavenTicketTakeResult,
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

export function decodeRavenAutopilotSettings(value: unknown): RavenAutopilotSettings {
  if (!isRavenAutopilotSettings(value)) throw new Error("Invalid Autopilot settings response.");
  return value;
}

export function decodeRavenTicketTake(value: unknown): RavenTicketTakeResult {
  if (!isRavenTicketTakeResult(value)) throw new Error("Invalid ticket take response.");
  return value;
}
