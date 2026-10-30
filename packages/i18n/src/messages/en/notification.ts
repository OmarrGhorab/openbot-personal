import { defineMessages } from "../../message";

export const messages = defineMessages("notification", {
  // Desktop notifications, raised by the main process while the window may be closed, and browser
  // notifications, raised by the web client while its tab is open.
  "notification.needsInput": "Needs your input.",
  "notification.needsApproval": "Needs your approval.",
  "notification.needsBrowserStep": "Needs you to finish a step in the browser.",
  "notification.needsApprovalFor": "Needs your approval: {action}",
  "notification.finished": "Finished working.",
  "notification.failed": "Stopped with an error.",
  // The title of a notification about an agent in a channel: the agent and the channel name.
  "notification.channelTitle": "{agent} in {channel}",
  "notification.workThreadTitle": "{agent}, task: {thread}",
  // The body of a channel reply notification when the preview of agent words is off.
  "notification.channelMessage": "Sent a message.",
  "notification.usageLimit.title": "{provider} account reached its limit",
  "notification.usageLimit.body": {
    one: "{count} agent waits. OpenBot will try again later.",
    other: "{count} agents wait. OpenBot will try again later.",
  },
  "notification.usageLimit.bodyResets": {
    one: "{count} agent waits. Resets {reset}.",
    other: "{count} agents wait. Resets {reset}.",
  },
  "notification.test": "Notifications are working.",
  "notification.welcome": "OpenBot will tell you here when an agent needs you.",
  // The toast region in each window.
  "notification.toast.region": "Notifications",
  "notification.toast.close": "Close notification",
  // A ticket the Reviewer merged: the system notification and the in-app toast. Facts only, never
  // a diff or agent text.
  "notification.ticketMerged.title": "{ticket} was merged",
  "notification.ticketMerged.body": "The Reviewer merged PR #{number}.",
  "notification.ticketMerged.bodyNoPullRequest": "The Reviewer merged it.",
  "notification.ticketMerged.pass": "PASS",
  "notification.ticketMerged.passWithNotes": "PASS with notes",
  "notification.ticketMerged.quality": "Quality {score}/10",
  "notification.ticketMerged.ciGreen": "CI green",
  "notification.ticketMerged.viewTicket": "View ticket",
  "notification.ticketMerged.viewPullRequest": "View PR",
  "notification.ticketMerged.dismiss": "Dismiss",
});
