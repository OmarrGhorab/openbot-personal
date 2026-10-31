// Ticket 267: after Stop all, a message the person sends stayed queued forever with Steer turned off,
// because the stop held every lane until Resume. A message the person writes means they want the agents
// back, so it lifts the stop before it is sent. Stop all still ends every running turn at once.

export interface StopAllState {
  stoppedAll: () => Promise<boolean>;
  resumeAll: () => Promise<void>;
}

/** Lifts Stop all for a message the person sends. Returns whether a stop was lifted. */
export async function releaseStopAllForMessage(state: StopAllState): Promise<boolean> {
  if (!(await state.stoppedAll())) return false;
  await state.resumeAll();
  return true;
}
