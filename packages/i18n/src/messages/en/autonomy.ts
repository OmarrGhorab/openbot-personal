import { defineMessages } from "../../message";

export const messages = defineMessages("autonomy", {
  // The Stop all agents control in the sidebar header.
  "autonomy.stopAll.stop": "Stop all agents",
  "autonomy.stopAll.resume": "Resume agents",
  "autonomy.stopAll.stopDescription":
    "Stops every running turn and holds every queue on this computer until you resume.",
  "autonomy.stopAll.resumeDescription": "Starts the queued messages of every agent again.",
  "autonomy.stopAll.failed": "OpenBot could not change the state of the agents.",
  "autonomy.stopAll.confirmTitle": "Stop all agents?",
  "autonomy.stopAll.confirmBody":
    "Every running turn stops and queued work waits. The next message you send starts the agents again.",

  // The Safety and limits settings tab.
  "autonomy.tab.title": "Safety and limits",
  "autonomy.tab.description": "Approvals, budgets, usage and the audit log of the agents on this computer.",
  "autonomy.tab.stoppedNotice": "All agents are stopped on this computer.",
  "autonomy.tab.loadFailed": "OpenBot could not load the agent settings.",
  "autonomy.tab.agent": "Agent",
  "autonomy.tab.agentDescription": "The approvals, budgets and usage below are for this agent.",
  "autonomy.tab.noAgents": "No agent runs on this computer yet.",

  "autonomy.approvals.title": "Approvals",
  "autonomy.approvals.description": "Low-risk actions never ask. Choose which higher-risk actions wait for you.",
  "autonomy.approvals.low": "Low risk: read, run tests, make a branch, push to the agent's own branch. Never asks.",
  "autonomy.approvals.medium.title": "Medium risk",
  "autonomy.approvals.medium.description":
    "Open or comment on a pull request, install dependencies, change files, and similar actions.",
  "autonomy.approvals.high.title": "High risk",
  "autonomy.approvals.high.description":
    "Merge, deploy, delete data, run migrations, change secrets, and push to the default branch.",
  "autonomy.approvals.saveFailed": "OpenBot could not save the approval rule.",

  "autonomy.budgets.title": "Budgets",
  "autonomy.budgets.description": "An agent stops and reports when a limit is reached. An empty field means no limit.",
  "autonomy.budgets.perTask": "Per work thread",
  "autonomy.budgets.perDay": "Per agent, per day",
  "autonomy.budgets.tokens": "Tokens",
  "autonomy.budgets.minutes": "Minutes",
  "autonomy.budgets.costUsd": "Cost (USD)",
  "autonomy.budgets.costNote": "The cost is an estimate. A model with no known price adds no cost.",
  "autonomy.budgets.invalid": "Enter a number above zero, or leave the field empty.",
  "autonomy.budgets.save": "Save limits",
  "autonomy.budgets.reset": "Reset",
  "autonomy.budgets.saveFailed": "OpenBot could not save the budget.",

  "autonomy.usage.title": "Usage",
  "autonomy.usage.today": "Today",
  "autonomy.usage.none": "No usage yet.",
  "autonomy.usage.noPrice": "no price",
  "autonomy.usage.limitReached": "Limit reached: {limit}",
  "autonomy.usage.summary": "{tokens} tokens, {minutes} min, {cost}",

  "autonomy.audit.title": "Audit log",
  "autonomy.audit.description": "Each autonomous action on this computer, newest first. Secrets are masked.",
  "autonomy.audit.empty": "No action is recorded yet.",
  "autonomy.audit.loadMore": "Load more",
  "autonomy.audit.loadFailed": "OpenBot could not read the audit log.",
  "autonomy.audit.filter.agent": "Agent",
  "autonomy.audit.filter.allAgents": "All agents",
  "autonomy.audit.filter.risk": "Risk",
  "autonomy.audit.filter.allRisks": "All risks",
  "autonomy.audit.filter.action": "Action",
  "autonomy.audit.filter.allActions": "All actions",
  "autonomy.audit.risk.low": "Low",
  "autonomy.audit.risk.medium": "Medium",
  "autonomy.audit.risk.high": "High",
  "autonomy.audit.action.approval.auto": "Approved without asking",
  "autonomy.audit.action.approval.asked": "Asked for approval",
  "autonomy.audit.action.approval.accepted": "Approved by you",
  "autonomy.audit.action.approval.declined": "Declined by you",
  "autonomy.audit.action.budget.stopped": "Stopped at a budget limit",
  "autonomy.audit.action.stop-all.started": "Stopped all agents",
  "autonomy.audit.action.stop-all.resumed": "Resumed all agents",
  "autonomy.audit.action.rules.changed": "Approval rule changed",
  "autonomy.audit.action.budgets.changed": "Budget changed",
});
