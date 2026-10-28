// The project memory of an agent's folder: facts that every agent in that folder shares. It stays on
// this computer, so no call goes to a remote host, and every endpoint is a plain request.

import type { AgentService } from "../../backend/agent-service";
import {
  parseCreateProjectMemory,
  parseDeleteProjectMemory,
  parseProjectMemoryAgent,
  parseUpdateProjectMemory,
} from "./agent-inputs";
import { type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";

interface ProjectMemoryIpcDependencies {
  service: AgentService;
}

export function projectMemoryIpcHandlers({
  service,
}: ProjectMemoryIpcDependencies): Pick<IpcGroupHandlers, "projectMemories"> {
  return {
    projectMemories: {
      getProjectMemories: payloadHandler(parseProjectMemoryAgent, (parsed) =>
        service.getProjectMemories(parsed.agentId),
      ),
      createProjectMemory: payloadHandler(parseCreateProjectMemory, (parsed) => service.createProjectMemory(parsed)),
      updateProjectMemory: payloadHandler(parseUpdateProjectMemory, (parsed) => service.updateProjectMemory(parsed)),
      deleteProjectMemory: payloadHandler(parseDeleteProjectMemory, (parsed) => service.deleteProjectMemory(parsed)),
      undoProjectMemory: payloadHandler(parseProjectMemoryAgent, (parsed) => service.undoProjectMemory(parsed.agentId)),
    },
  };
}
