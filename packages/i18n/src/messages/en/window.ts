import { defineMessages } from "../../message";

export const messages = defineMessages("window", {
  // Native window titles.
  "window.localHostTitle": "OpenBot Local Host",
  "window.localClientTitle": "OpenBot Local Client",
  "window.computerUsePermissionTitle": "Turn on Computer Use",
  "window.recover.crashedTitle": "The window stopped",
  "window.recover.crashedDetail":
    "It stopped several times in a row, often because it ran out of memory. Your agents keep running.",
  "window.recover.hungTitle": "The window is not responding",
  "window.recover.hungDetail": "Reload it, or wait for it to answer. Your agents keep running.",
  "window.recover.reload": "Reload",
  "window.recover.wait": "Wait",
});
