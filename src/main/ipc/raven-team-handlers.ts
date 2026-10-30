// A Raven Stack team: templates, the plan of a start, and the jobs of this computer's local agents.
// The team's roles are local agents, so every endpoint is a plain request on this computer.

import { runCauseEffect } from "../../backend/effect-boundary";
import type { RavenTeamService } from "../../backend/raven-team/raven-team-service";
import type { TicketTakeService } from "../../backend/raven-team/ticket-take";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import {
  parseGiveRavenRoleFullAccess,
  parsePlanRavenTeam,
  parseRavenJobId,
  parseRavenTemplateId,
  parseSaveRavenTemplate,
  parseSetRavenRoleModel,
  parseTakeRavenTicket,
} from "./raven-team-inputs";

interface RavenTeamIpcDependencies {
  ravenTeam: RavenTeamService;
  ticketTake: TicketTakeService;
}

export function ravenTeamIpcHandlers({
  ravenTeam,
  ticketTake,
}: RavenTeamIpcDependencies): Pick<IpcGroupHandlers, "ravenTeam"> {
  return {
    ravenTeam: {
      listTemplates: handler(() => ravenTeam.templates()),
      saveTemplate: payloadHandler(parseSaveRavenTemplate, (input) => ravenTeam.saveTemplate(input)),
      deleteTemplate: payloadHandler(parseRavenTemplateId, (templateId) => ravenTeam.deleteTemplate(templateId)),
      plan: payloadHandler(parsePlanRavenTeam, (input) => ravenTeam.plan(input)),
      start: payloadHandler(parsePlanRavenTeam, (input) => runCauseEffect(ravenTeam.start(input))),
      listJobs: handler(() => ravenTeam.listJobs()),
      setRoleModel: payloadHandler(parseSetRavenRoleModel, (input) => runCauseEffect(ravenTeam.setRoleModel(input))),
      giveRoleFullAccess: payloadHandler(parseGiveRavenRoleFullAccess, (input) =>
        runCauseEffect(ravenTeam.giveRoleFullAccess(input)),
      ),
      stop: payloadHandler(parseRavenJobId, (jobId) => runCauseEffect(ravenTeam.stop(jobId))),
      resume: payloadHandler(parseRavenJobId, (jobId) => runCauseEffect(ravenTeam.resume(jobId))),
      // Chat (#200): main reads the message again; the renderer only asks.
      takeTicket: payloadHandler(parseTakeRavenTicket, (input) => runCauseEffect(ticketTake.take(input))),
    },
  };
}
