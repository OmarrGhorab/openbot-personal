// Graded permissions, budgets, the audit log and Stop all agents of this computer. Every call is local:
// the settings file and the database of this computer hold them, and no remote server reads them.

import {
  parseAutonomyAuditFilter,
  parseSetAgentApprovalRulesInput,
  parseSetAgentBudgetsInput,
} from "@openbot/contracts/ipc";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { AutonomyAdmin } from "../autonomy-admin";
import type { IpcGroupHandlers } from "./define-ipc-group";
import { handler, payloadHandler } from "./define-ipc-group";

export interface AutonomyIpcDependencies {
  autonomy: AutonomyAdmin;
}

export function autonomyIpcHandlers({ autonomy }: AutonomyIpcDependencies): Pick<IpcGroupHandlers, "autonomy"> {
  return {
    autonomy: {
      getSnapshot: handler(() => runCauseEffect(autonomy.snapshot())),
      setApprovalRules: payloadHandler(parseSetAgentApprovalRulesInput, (input) =>
        runCauseEffect(autonomy.setApprovalRules(input)),
      ),
      setBudgets: payloadHandler(parseSetAgentBudgetsInput, (input) => runCauseEffect(autonomy.setBudgets(input))),
      stopAll: handler(() => runCauseEffect(autonomy.stopAll())),
      resumeAll: handler(() => runCauseEffect(autonomy.resumeAll())),
      listAuditLog: payloadHandler(parseAutonomyAuditFilter, (filter) => runCauseEffect(autonomy.listAuditLog(filter))),
    },
  };
}
