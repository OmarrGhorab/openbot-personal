// What main sends for the Monitor: the snapshot of a channel and its change event.

import { isMonitorChange, isMonitorConversation, isMonitorSnapshot } from "@openbot/contracts/ipc";
import { guardedDecoder } from "@openbot/contracts/ipc-decoding";

export const decodeMonitorSnapshot = guardedDecoder(isMonitorSnapshot, "monitor snapshot response");
export const decodeMonitorChange = guardedDecoder(isMonitorChange, "monitor change event");
export const decodeMonitorConversation = guardedDecoder(isMonitorConversation, "monitor conversation response");
