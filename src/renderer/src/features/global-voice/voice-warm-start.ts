/**
 * Starts loading the voice model and opens the microphone at the same time. The user can start
 * speaking at once; the main process makes the first transcription wait for the load rather than
 * load the model twice. A failed load is ignored, since the first transcription loads the model itself.
 */
export function openWhileWarming<T>(warm: () => Promise<void>, open: () => Promise<T>): Promise<T> {
  void warm().catch(() => undefined);
  return open();
}
