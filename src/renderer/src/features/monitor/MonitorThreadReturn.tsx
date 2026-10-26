import { MonitorReturnBar } from "@openbot/ui/features/monitor/MonitorReturnBar";
import { Show } from "solid-js";
import { useMonitor } from "./monitor-context";

/** "Back to monitor" above the thread of `agentId`, when "Open thread" in the agent popup opened it. */
export function MonitorThreadReturn(props: { agentId: string | null | undefined }) {
  const monitor = useMonitor();
  return (
    <Show when={props.agentId && monitor.state.threadAgentId === props.agentId}>
      <MonitorReturnBar onBack={() => monitor.returnToMonitor()} />
    </Show>
  );
}
