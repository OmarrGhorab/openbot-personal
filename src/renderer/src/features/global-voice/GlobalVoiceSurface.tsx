import type { GlobalVoiceCommand, GlobalVoicePickerAgent, GlobalVoicePickerSnapshot } from "@openbot/contracts/ipc";
import { Button, Input, Textarea } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createMemo, createStore, For, onSettled, Show } from "solid-js";
import { GlobalVoiceDictation, GlobalVoiceDictationError } from "./global-voice-dictation";
import {
  filterGlobalVoiceAgents,
  globalVoiceInitials,
  globalVoiceNumberKeyIndex,
  moveGlobalVoiceHighlight,
} from "./global-voice-picker-logic";
import "./global-voice.css";

/** How long the confirmation stays after a message is sent, and the error after a failed dictation. */
const SENT_CONFIRMATION_MS = 1_500;
const ERROR_VISIBLE_MS = 3_000;

type Phase = "idle" | "preparing" | "listening" | "transcribing" | "review" | "sending" | "sent";
type View = "hidden" | "pill" | "picker";

interface SurfaceState {
  view: View;
  phase: Phase;
  /** The agent that the dictation goes to. */
  targetId: string | null;
  snapshotId: number;
  agents: GlobalVoicePickerAgent[];
  sendAfterSpeaking: boolean;
  query: string;
  highlight: number;
  transcript: string;
  error: string | null;
}

/**
 * The window of the global voice shortcuts. The pill shows a dictation to the current agent; the
 * picker lists the agents. The window records the microphone itself, so it does not need the main
 * window. Main sends the shortcuts, Tab and Escape while the dictation listens, and the snapshot each
 * time the window opens.
 */
export function GlobalVoiceSurface() {
  const { t, errorMessage } = useText();
  const dictation = new GlobalVoiceDictation();
  const [state, setState] = createStore<SurfaceState>({
    view: "hidden",
    phase: "idle",
    targetId: null,
    snapshotId: 0,
    agents: [],
    sendAfterSpeaking: true,
    query: "",
    highlight: 0,
    transcript: "",
    error: null,
  });
  /** Sets one field of the state. The store takes a draft only, as this Solid release requires. */
  const set = <Key extends keyof SurfaceState>(key: Key, value: SurfaceState[Key]) => {
    setState((draft) => {
      draft[key] = value;
    });
  };
  /** Changes on each Escape, so a dictation that was cancelled while it started or stopped does nothing. */
  let generation = 0;
  let timers: Array<ReturnType<typeof setTimeout>> = [];
  let searchBox: HTMLDivElement | undefined;
  let reviewBox: HTMLDivElement | undefined;

  const filtered = createMemo(() => filterGlobalVoiceAgents(state.agents, state.query));
  const targetAgent = () => state.agents.find((agent) => agent.agentId === state.targetId);
  const targetName = () => targetAgent()?.name ?? "";

  const later = (callback: () => void, delay: number) => {
    timers.push(setTimeout(callback, delay));
  };
  const clearLater = () => {
    for (const timer of timers) clearTimeout(timer);
    timers = [];
  };

  function setView(view: View, listening: boolean): void {
    set("view", view);
    void window.openbot.globalVoice.setView({ view, listening: listening && view !== "hidden" });
  }

  function hide(): void {
    clearLater();
    dictation.cancel();
    generation += 1;
    setState((draft) => {
      draft.phase = "idle";
      draft.transcript = "";
      draft.error = null;
    });
    setView("hidden", false);
  }

  function failWith(message: string): void {
    setState((draft) => {
      draft.phase = "idle";
      draft.error = message;
    });
    setView("pill", false);
    later(hide, ERROR_VISIBLE_MS);
  }

  function dictationFailure(error: unknown): string {
    if (error instanceof GlobalVoiceDictationError) {
      if (error.kind === "noSpeech") return t("globalVoice.picker.noSpeech");
      if (error.kind === "unavailable") return errorMessage(error.message, t("globalVoice.picker.dictationFailed"));
    }
    return errorMessage(error, t("globalVoice.picker.dictationFailed"));
  }

  /** Starts a dictation to an agent at once. The microphone opens after the model is ready. */
  function startFor(agentId: string): void {
    clearLater();
    generation += 1;
    const current = generation;
    setState((draft) => {
      draft.targetId = agentId;
      draft.phase = "preparing";
      draft.transcript = "";
      draft.error = null;
    });
    setView("pill", false);
    dictation
      .start({
        onLive: (text) => {
          if (current === generation) set("transcript", text);
        },
        onLimit: () => void stopAndDeliver(),
      })
      .then(() => {
        if (current !== generation) {
          dictation.cancel();
          return;
        }
        set("phase", "listening");
        setView("pill", true);
      })
      .catch((error: unknown) => {
        if (current === generation) failWith(dictationFailure(error));
      });
  }

  /** Stops the dictation and gives the text to the agent, or keeps it for review. */
  async function stopAndDeliver(): Promise<void> {
    if (state.phase !== "listening") return;
    const current = generation;
    set("phase", "transcribing");
    setView("pill", false);
    let text: string;
    try {
      text = await dictation.stop();
    } catch (error) {
      if (current === generation) failWith(dictationFailure(error));
      return;
    }
    if (current !== generation) return;
    set("transcript", text);
    if (state.sendAfterSpeaking) {
      await sendTranscript();
      return;
    }
    setState((draft) => {
      draft.phase = "review";
      draft.error = null;
    });
    setView("picker", false);
    reviewBox?.querySelector("textarea")?.focus();
  }

  /** Sends the text in the window to the target agent. A failed send keeps the text for another try. */
  async function sendTranscript(): Promise<void> {
    const agentId = state.targetId;
    const text = state.transcript.trim();
    if (!agentId || !text) return;
    const current = generation;
    setState((draft) => {
      draft.phase = "sending";
      draft.error = null;
    });
    setView("pill", false);
    try {
      await window.openbot.globalVoice.sendTranscript({ agentId, text });
    } catch (error) {
      if (current !== generation) return;
      setState((draft) => {
        draft.phase = "review";
        draft.error = errorMessage(error, t("globalVoice.picker.sendFailed"));
      });
      setView("picker", false);
      reviewBox?.querySelector("textarea")?.focus();
      return;
    }
    if (current !== generation) return;
    setState((draft) => {
      draft.phase = "sent";
      draft.transcript = "";
    });
    setView("pill", false);
    later(hide, SENT_CONFIRMATION_MS);
  }

  /** Cancels a dictation that listens or starts, and closes the window. */
  function cancel(): void {
    hide();
  }

  /** Chooses an agent from the picker: a new dictation starts, or the target changes while one listens. */
  function choose(agent: GlobalVoicePickerAgent): void {
    if (state.phase === "listening") {
      set("targetId", agent.agentId);
      setView("pill", true);
      return;
    }
    if (state.phase === "review") {
      set("targetId", agent.agentId);
      return;
    }
    if (state.phase === "idle") startFor(agent.agentId);
  }

  function applySnapshot(snapshot: GlobalVoicePickerSnapshot): void {
    if (snapshot.id === state.snapshotId) return;
    clearLater();
    dictation.cancel();
    generation += 1;
    setState((draft) => {
      draft.snapshotId = snapshot.id;
      draft.agents = snapshot.agents;
      draft.sendAfterSpeaking = snapshot.sendAfterSpeaking;
      draft.query = "";
      draft.highlight = 0;
      draft.transcript = "";
      draft.error = null;
      draft.phase = "idle";
      draft.targetId = snapshot.currentAgentId;
    });
    if (snapshot.request.type === "agent") {
      startFor(snapshot.request.agentId);
      return;
    }
    setView("picker", false);
    searchBox?.querySelector("input")?.focus();
  }

  function applyCommand(command: GlobalVoiceCommand): void {
    if (command.type === "cancel") {
      cancel();
      return;
    }
    if (command.type === "choose") {
      // Tab while the dictation listens opens the picker and keeps listening.
      if (state.phase === "listening" || state.phase === "idle" || state.phase === "review") {
        setView("picker", state.phase === "listening");
        searchBox?.querySelector("input")?.focus();
      }
      return;
    }
    if (state.phase === "sent") {
      // The confirmation gives way to the next dictation at once.
      hide();
      startFor(command.agentId);
    } else if (state.phase === "idle") {
      startFor(command.agentId);
    } else if (state.phase === "listening" && state.targetId === command.agentId) {
      void stopAndDeliver();
    } else if (state.phase === "listening") {
      // A direct shortcut for another agent while one listens: that agent gets the text.
      set("targetId", command.agentId);
      void stopAndDeliver();
    } else if (state.phase === "review") {
      set("targetId", command.agentId);
      void sendTranscript();
    }
  }

  onSettled(() => {
    const api = window.openbot.globalVoice;
    const stopOpened = api.onPickerOpened(applySnapshot);
    const stopShortcut = api.onPickerShortcut(applyCommand);
    void api.getPickerSnapshot().then((snapshot) => {
      if (snapshot) applySnapshot(snapshot);
    });
    // A picker that loses focus while it waits for a choice closes, as a menu does.
    const onBlur = () => {
      if (state.view === "picker" && state.phase === "idle") hide();
    };
    window.addEventListener("blur", onBlur);
    return () => {
      stopOpened();
      stopShortcut();
      window.removeEventListener("blur", onBlur);
      clearLater();
      dictation.cancel();
    };
  });

  function onPickerKeyDown(event: KeyboardEvent): void {
    if (event.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
      return;
    }
    if (state.phase === "review") {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void sendTranscript();
      }
      return;
    }
    if (state.phase === "listening") {
      if (event.key === "Enter") {
        event.preventDefault();
        void stopAndDeliver();
      }
      return;
    }
    if (state.phase !== "idle") return;
    const list = filtered();
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      set("highlight", moveGlobalVoiceHighlight(state.highlight, list.length, event.key === "ArrowDown" ? 1 : -1));
      return;
    }
    if (event.key === "Enter") {
      const agent = list[state.highlight];
      if (agent) {
        event.preventDefault();
        choose(agent);
      }
      return;
    }
    const numbered = globalVoiceNumberKeyIndex(event.key, state.query, list.length);
    const agent = numbered === null ? undefined : list[numbered];
    if (agent) {
      event.preventDefault();
      choose(agent);
    }
  }

  const hint = () => {
    if (state.phase === "listening") return t("globalVoice.picker.hintListening");
    if (state.phase === "review") return t("globalVoice.picker.hintReview");
    return t("globalVoice.picker.hintChoose");
  };
  const phaseText = () => {
    switch (state.phase) {
      case "preparing":
        return t("globalVoice.picker.preparing");
      case "listening":
        return t("globalVoice.picker.listening", { agent: targetName() });
      case "transcribing":
        return t("globalVoice.picker.transcribing");
      case "sending":
        return t("globalVoice.picker.sending", { agent: targetName() });
      case "sent":
        return t("globalVoice.picker.sent", { agent: targetName() });
      default:
        return "";
    }
  };

  return (
    <Show
      when={state.view === "picker"}
      fallback={
        <section class="global-voice-pill" data-phase={state.phase} role="status" aria-live="polite">
          <span class="global-voice-pill-dot" aria-hidden="true" />
          <div class="global-voice-pill-body">
            <Show when={state.error} fallback={<span class="global-voice-pill-phase">{phaseText()}</span>}>
              {(message) => <span class="global-voice-pill-error">{message()}</span>}
            </Show>
            <Show when={state.transcript && state.phase !== "sent"}>
              <span class="global-voice-pill-transcript" dir="auto">
                {state.transcript}
              </span>
            </Show>
          </div>
        </section>
      }
    >
      <section class="global-voice-picker" aria-label={t("globalVoice.picker.label")} onKeyDown={onPickerKeyDown}>
        <Show when={state.phase === "review"} fallback={<PickerList />}>
          <div class="global-voice-review" ref={(element) => (reviewBox = element)}>
            <span class="global-voice-review-label">
              {t("globalVoice.picker.transcriptLabel", { agent: targetName() })}
            </span>
            <Textarea
              aria-label={t("globalVoice.picker.transcriptLabel", { agent: targetName() })}
              class="global-voice-review-text"
              dir="auto"
              value={state.transcript}
              placeholder={t("globalVoice.picker.transcriptPlaceholder")}
              onValueChange={(value) => set("transcript", value)}
            />
          </div>
        </Show>
        <Show when={state.error}>{(message) => <p class="global-voice-picker-error">{message()}</p>}</Show>
        <p class="global-voice-picker-hint">{hint()}</p>
      </section>
    </Show>
  );

  function PickerList() {
    return (
      <>
        <div class="global-voice-search" ref={(element) => (searchBox = element)}>
          <Input
            type="search"
            aria-label={t("globalVoice.picker.search")}
            class="global-voice-search-input"
            placeholder={t("globalVoice.picker.searchPlaceholder")}
            value={state.query}
            onValueChange={(value) => {
              setState((draft) => {
                draft.query = value;
                draft.highlight = 0;
              });
            }}
          />
        </div>
        <Show
          when={filtered().length > 0}
          fallback={
            <p class="global-voice-empty">
              {state.agents.length === 0 ? t("globalVoice.picker.noAgents") : t("globalVoice.picker.empty")}
            </p>
          }
        >
          <section class="global-voice-list" aria-label={t("globalVoice.picker.list")}>
            <For each={filtered()}>
              {(agent, index) => (
                <Button
                  type="button"
                  variant="ghost"
                  class="global-voice-option"
                  aria-current={index() === state.highlight ? "true" : undefined}
                  aria-keyshortcuts={index() < 9 ? String(index() + 1) : undefined}
                  aria-label={agent.name}
                  data-current={agent.agentId === state.targetId ? "true" : undefined}
                  onPointerEnter={() => set("highlight", index())}
                  onClick={() => choose(agent)}
                >
                  <span class="global-voice-avatar" aria-hidden="true">
                    {globalVoiceInitials(agent.name)}
                  </span>
                  <span class="global-voice-option-text">
                    <span class="global-voice-option-name" dir="auto">
                      {agent.name}
                    </span>
                    <Show when={agent.title}>
                      <span class="global-voice-option-title" dir="auto">
                        {agent.title}
                      </span>
                    </Show>
                  </span>
                  <Show when={index() < 9}>
                    <span class="global-voice-option-key" aria-hidden="true">
                      {index() + 1}
                    </span>
                  </Show>
                </Button>
              )}
            </For>
          </section>
        </Show>
      </>
    );
  }
}
