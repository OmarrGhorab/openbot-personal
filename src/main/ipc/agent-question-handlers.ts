// The Questions list: every question that waits for an answer on this computer. The list is local, so
// it is a plain request, not scoped to a host. Answers go through `agent:respond-to-prompt`.

import type { AgentService } from "../../backend/agent-service";
import { handler, type IpcGroupHandlers } from "./define-ipc-group";

interface AgentQuestionIpcDependencies {
  service: AgentService;
}

export function agentQuestionIpcHandlers({
  service,
}: AgentQuestionIpcDependencies): Pick<IpcGroupHandlers, "agentQuestions"> {
  return {
    agentQuestions: {
      listOpenQuestions: handler(() => service.listOpenQuestions()),
    },
  };
}
