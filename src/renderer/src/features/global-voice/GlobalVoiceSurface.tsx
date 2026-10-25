import type {
  GlobalVoiceCommand,
  GlobalVoiceKeyRelease,
  GlobalVoicePickerAgent,
  GlobalVoicePickerSnapshot,
} from "@openbot/contracts/ipc";
import { localeDirection } from "@openbot/i18n";
import { Button, Input, Textarea } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { createEffect, createMemo, createStore, For, onCleanup, onSettled, Show } from "solid-js";
import { GlobalVoiceDictation, GlobalVoiceDictationError } from "./global-voice-dictation";
import {
  GLOBAL_VOICE_ISLAND,
  globalVoiceTextDirection,
  type IslandSize,
  islandScaleKeyframes,
} from "./global-voice-island-motion";
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
  /** This recording ends when the key comes up. A picker release starts a toggle recording instead. */
  sessionHold: boolean;
  holdToTalk: boolean;
  keyRelease: GlobalVoiceKeyRelease;
  query: string;
  highlight: number;
  transcript: string;
  error: string | null;
  /** Which button the error offers. */
  errorAction: "none" | "microphone" | "accessibility";
  /** The model download, in percent, while the first dictation waits for it. */
  download: number | null;
}

/**
 * The window of the global voice shortcuts. The pill shows a dictation to the current agent; the
 * picker lists the agents. The window records the microphone itself, so it does not need the main
 * window. Main sends the shortcuts, Tab and Escape while the dictation listens, and the snapshot each
 * time the window opens.
 */
export function GlobalVoiceSurface() {
  const { t, errorMessage, locale } = useText();
  const dictation = new GlobalVoiceDictation();
  const [state, setState] = createStore<SurfaceState>({
    view: "hidden",
    phase: "idle",
    targetId: null,
    snapshotId: 0,
    agents: [],
    sendAfterSpeaking: true,
    sessionHold: false,
    holdToTalk: true,
    keyRelease: "ready",
    query: "",
    highlight: 0,
    transcript: "",
    error: null,
    errorAction: "none",
    download: null,
  });
  /** Sets one field of the state. The store takes a draft only, as this Solid release requires. */
  const set = <Key extends keyof SurfaceState>(key: Key, value: SurfaceState[Key]) => {
    setState((draft) => {
      draft[key] = value;
    });
  };
  /** Changes on each Escape, so a dictation that was cancelled while it started or stopped does nothing. */
  let generation = 0;
  /** A hold ended while the microphone was still opening. */
  let stopWhenReady = false;
  let timers: Array<ReturnType<typeof setTimeout>> = [];
  let searchBox: HTMLDivElement | undefined;
  let reviewBox: HTMLDivElement | undefined;
  let shell: HTMLElement | undefined;
  let phaseNode: HTMLSpanElement | undefined;
  let waveRoot: HTMLDivElement | undefined;
  let shellSize: IslandSize = GLOBAL_VOICE_ISLAND.notch;
  let shellAnimation: Animation | undefined;
  let level = 0;
  /** The user moved the highlight, so the picker stays open while the key is held. */
  let pickerPinned = false;

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

  function reducedMotion(): boolean {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  /** The shell is already the next size. The animation only scales and fades it. */
  function paintIsland(size: IslandSize, fromNotch: boolean): void {
    const element = shell;
    if (!element) return;
    const from = fromNotch ? GLOBAL_VOICE_ISLAND.notch : shellSize;
    shellSize = size;
    element.style.width = `${size.width}px`;
    element.style.height = `${size.height}px`;
    shellAnimation?.cancel();
    const reveal = () => {
      element.style.opacity = "1";
      element.style.removeProperty("transform");
    };
    if (typeof element.animate !== "function") {
      reveal();
      return;
    }
    const frames = islandScaleKeyframes(from, size, reducedMotion());
    shellAnimation = element.animate(frames, {
      duration: reducedMotion() ? 120 : 400,
      easing: "linear",
      fill: "both",
    });
    shellAnimation.addEventListener("finish", reveal);
    shellAnimation.addEventListener("cancel", reveal);
  }

  function showIsland(view: Exclude<View, "hidden">, listening: boolean): void {
    const fromNotch = state.view === "hidden";
    const size = view === "picker" ? GLOBAL_VOICE_ISLAND.picker : GLOBAL_VOICE_ISLAND.pill;
    const same =
      !fromNotch && state.view === view && shellSize.width === size.width && shellSize.height === size.height;
    // Paint the collapsed scale before the window appears, so the first frame is the notch.
    if (fromNotch && shell && typeof shell.animate === "function") {
      const notch = GLOBAL_VOICE_ISLAND.notch;
      shell.style.width = `${size.width}px`;
      shell.style.height = `${size.height}px`;
      shell.style.opacity = "0";
      shell.style.transform = `scale(${notch.width / size.width}, ${notch.height / size.height})`;
    }
    setView(view, listening);
    if (!same) paintIsland(size, fromNotch);
    const keyboard = view === "picker" || state.phase === "review";
    const interactive = keyboard || state.phase === "sent" || state.error !== null;
    void window.openbot.globalVoice.setInteractive({ interactive, keyboard });
  }

  function hide(): void {
    clearLater();
    dictation.cancel();
    generation += 1;
    level = 0;
    pickerPinned = false;
    setState((draft) => {
      draft.phase = "idle";
      draft.transcript = "";
      draft.error = null;
      draft.errorAction = "none";
    });
    paintIsland(GLOBAL_VOICE_ISLAND.notch, false);
    const animation = shellAnimation;
    const finish = () => setView("hidden", false);
    if (animation) animation.onfinish = finish;
    else finish();
  }

  function failWith(message: string, action: SurfaceState["errorAction"] = "none"): void {
    setState((draft) => {
      draft.phase = "idle";
      draft.error = message;
      draft.errorAction = action;
    });
    showIsland("pill", false);
    later(hide, ERROR_VISIBLE_MS);
  }

  function dictationFailure(error: unknown): { message: string; action: SurfaceState["errorAction"] } {
    if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "NotFoundError")) {
      return { message: t("globalVoice.picker.microphoneDenied"), action: "microphone" };
    }
    if (error instanceof GlobalVoiceDictationError) {
      if (error.kind === "noSpeech") return { message: t("globalVoice.picker.noSpeech"), action: "none" };
      if (error.kind === "unavailable")
        return { message: errorMessage(error.message, t("globalVoice.picker.dictationFailed")), action: "none" };
    }
    return { message: errorMessage(error, t("globalVoice.picker.dictationFailed")), action: "none" };
  }

  /** Starts a dictation to an agent at once. The microphone opens after the model is ready. */
  function startFor(agentId: string, hold: boolean): void {
    clearLater();
    stopWhenReady = false;
    pickerPinned = false;
    generation += 1;
    const current = generation;
    const openPicker = hold && state.agents.length > 1;
    setState((draft) => {
      draft.targetId = agentId;
      draft.sessionHold = hold;
      draft.phase = "preparing";
      draft.transcript = "";
      draft.error = null;
      draft.errorAction = "none";
    });
    showIsland(openPicker ? "picker" : "pill", false);
    if (openPicker) {
      later(() => {
        if (current !== generation || pickerPinned || state.phase === "idle") return;
        if (state.view === "picker") showIsland("pill", state.phase === "listening");
      }, 450);
    }
    dictation
      .start({
        onLive: (text) => {
          if (current === generation) set("transcript", text);
        },
        onLevel: (value) => {
          level = value;
        },
        onLimit: () => void stopAndDeliver(),
      })
      .then(() => {
        if (current !== generation) {
          dictation.cancel();
          return;
        }
        set("phase", "listening");
        showIsland(state.view === "picker" ? "picker" : "pill", true);
        // The key can come up before the microphone is ready. End the recording then.
        if (state.sessionHold && stopWhenReady) void stopAndDeliver();
      })
      .catch((error: unknown) => {
        if (current !== generation) return;
        const failure = dictationFailure(error);
        failWith(failure.message, failure.action);
      });
  }

  /** Stops the dictation and gives the text to the agent, or keeps it for review. */
  async function stopAndDeliver(): Promise<void> {
    if (state.phase !== "listening") return;
    const current = generation;
    set("phase", "transcribing");
    showIsland("pill", false);
    let text: string;
    try {
      text = await dictation.stop();
    } catch (error) {
      if (current === generation) {
        const failure = dictationFailure(error);
        failWith(failure.message, failure.action);
      }
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
    showIsland("picker", false);
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
    showIsland("pill", false);
    try {
      await window.openbot.globalVoice.sendTranscript({ agentId, text });
    } catch (error) {
      if (current !== generation) return;
      setState((draft) => {
        draft.phase = "review";
        draft.error = errorMessage(error, t("globalVoice.picker.sendFailed"));
      });
      showIsland("picker", false);
      reviewBox?.querySelector("textarea")?.focus();
      return;
    }
    if (current !== generation) return;
    setState((draft) => {
      draft.phase = "sent";
      draft.transcript = "";
    });
    showIsland("pill", false);
    later(hide, SENT_CONFIRMATION_MS);
  }

  /** Cancels a dictation that listens or starts, and closes the window. */
  function cancel(): void {
    hide();
  }

  /**
   * Targets an agent chosen in the picker, and tells main, so the next dictation shortcut goes to it
   * even when the picker closes before a message is sent.
   */
  function pick(agentId: string): void {
    set("targetId", agentId);
    void window.openbot.globalVoice.selectAgent({ agentId }).catch(() => undefined);
  }

  /** Chooses an agent from the picker: a new dictation starts, or the target changes while one listens. */
  function choose(agent: GlobalVoicePickerAgent): void {
    if (state.phase === "listening") {
      pick(agent.agentId);
      showIsland("pill", true);
      return;
    }
    if (state.phase === "review") {
      pick(agent.agentId);
      return;
    }
    if (state.phase === "idle") {
      void window.openbot.globalVoice.selectAgent({ agentId: agent.agentId }).catch(() => undefined);
      startFor(agent.agentId, false);
    }
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
      draft.highlight = Math.max(
        0,
        snapshot.agents.findIndex((agent) => agent.agentId === snapshot.currentAgentId),
      );
      draft.transcript = "";
      draft.error = null;
      draft.errorAction = "none";
      draft.phase = "idle";
      draft.sessionHold = false;
      draft.holdToTalk = snapshot.holdToTalk;
      draft.keyRelease = snapshot.keyRelease;
      draft.targetId = snapshot.currentAgentId;
    });
    stopWhenReady = false;
    if (snapshot.request.type === "agent") {
      startFor(snapshot.request.agentId, snapshot.holdToTalk);
      return;
    }
    showIsland("picker", false);
    searchBox?.querySelector("input")?.focus();
  }

  function highlightedAgent(): GlobalVoicePickerAgent | undefined {
    return filtered()[state.highlight];
  }

  function applyCommand(command: GlobalVoiceCommand): void {
    if (command.type === "cancel") {
      cancel();
      return;
    }
    if (command.type === "release") {
      if (command.source === "picker") {
        const agent = highlightedAgent();
        if (state.phase === "idle" && agent) choose(agent);
        else if (state.phase === "listening" && agent) pick(agent.agentId);
        return;
      }
      if (!state.sessionHold) return;
      const agent = highlightedAgent();
      if (state.view === "picker" && agent) pick(agent.agentId);
      if (state.phase === "preparing") stopWhenReady = true;
      else void stopAndDeliver();
      return;
    }
    if (command.type === "choose") {
      // A second press of the picker shortcut moves the highlight. The first press opens it.
      if (state.view === "picker" && (state.phase === "idle" || state.phase === "listening")) {
        pickerPinned = true;
        set("highlight", moveGlobalVoiceHighlight(state.highlight, filtered().length, 1));
        return;
      }
      // Tab while the dictation listens opens the picker and keeps listening.
      if (state.phase === "listening" || state.phase === "idle" || state.phase === "review") {
        showIsland("picker", state.phase === "listening");
        searchBox?.querySelector("input")?.focus();
      }
      return;
    }
    if (state.phase === "sent") {
      // The confirmation gives way to the next dictation at once.
      hide();
      startFor(command.agentId, state.holdToTalk);
    } else if (state.phase === "idle") {
      startFor(command.agentId, state.holdToTalk);
    } else if (state.phase === "listening" && state.targetId === command.agentId && !state.sessionHold) {
      void stopAndDeliver();
    } else if (state.phase === "listening" && state.sessionHold) {
      set("targetId", command.agentId);
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
    const stopModel = window.openbot.voice.onModelStatus((status) =>
      set("download", status.phase === "downloading" ? Math.round(status.progress ?? 0) : null),
    );
    void api.getPickerSnapshot().then((snapshot) => {
      if (snapshot) applySnapshot(snapshot);
    });
    // A picker that loses focus while it waits for a choice closes, as a menu does.
    const onBlur = () => {
      if (state.view === "picker" && state.phase === "idle") hide();
    };
    window.addEventListener("blur", onBlur);
    const onPointerDown = (event: PointerEvent) => {
      if (state.view !== "picker" || state.phase !== "idle") return;
      if (event.target instanceof Node && shell?.contains(event.target)) return;
      hide();
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      stopOpened();
      stopShortcut();
      stopModel();
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pointerdown", onPointerDown);
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
      pickerPinned = true;
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
    if (state.phase === "listening")
      return state.sessionHold ? t("globalVoice.picker.hintHold") : t("globalVoice.picker.hintListening");
    if (state.phase === "review") return t("globalVoice.picker.hintReview");
    return t("globalVoice.picker.hintChoose");
  };

  onSettled(() => {
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      if (!waveRoot || state.phase !== "listening") return;
      const now = performance.now();
      for (let index = 0; index < waveRoot.children.length; index += 1) {
        const bar = waveRoot.children.item(index);
        if (!(bar instanceof HTMLElement)) continue;
        const wobble = 0.55 + 0.45 * Math.sin(now / 140 + index);
        bar.style.transform = `scaleY(${0.2 + level * wobble})`;
      }
    };
    frame = requestAnimationFrame(tick);
    let overIsland = false;
    const onMove = (event: MouseEvent) => {
      const rect = shell?.getBoundingClientRect();
      const inside = rect
        ? event.clientX >= rect.left &&
          event.clientX <= rect.right &&
          event.clientY >= rect.top &&
          event.clientY <= rect.bottom
        : false;
      if (inside === overIsland) return;
      overIsland = inside;
      const keyboard = state.view === "picker" || state.phase === "review";
      void window.openbot.globalVoice.setInteractive({ interactive: inside || keyboard, keyboard });
    };
    window.addEventListener("mousemove", onMove);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("mousemove", onMove);
    };
  });

  createEffect(() => {
    if (state.phase !== "transcribing") return;
    const node = phaseNode;
    if (!node) return;
    const animation = node.animate([{ opacity: 0.35 }, { opacity: 1 }, { opacity: 0.35 }], {
      duration: reducedMotion() ? 120 : 900,
      iterations: Infinity,
    });
    onCleanup(() => animation.cancel());
  });
  const phaseText = () => {
    switch (state.phase) {
      case "preparing":
        return state.download === null
          ? t("globalVoice.picker.preparing")
          : t("globalVoice.picker.downloading", { percent: state.download });
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
    <div class="global-voice-stage" dir={localeDirection(locale())}>
      <section
        class="global-voice-island"
        data-phase={state.phase}
        data-shape={state.view === "picker" ? "picker" : "pill"}
        role="status"
        aria-live="polite"
        aria-label={t("globalVoice.picker.label")}
        ref={(element) => (shell = element)}
        onKeyDown={onPickerKeyDown}
      >
        <Show when={state.view === "picker"} fallback={<PillBody />}>
          <Show when={state.phase === "review"} fallback={<PickerList />}>
            <div class="global-voice-review" ref={(element) => (reviewBox = element)}>
              <span class="global-voice-review-label">
                {t("globalVoice.picker.transcriptLabel", { agent: targetName() })}
              </span>
              <Textarea
                aria-label={t("globalVoice.picker.transcriptLabel", { agent: targetName() })}
                class="global-voice-review-text"
                dir={globalVoiceTextDirection(state.transcript)}
                value={state.transcript}
                placeholder={t("globalVoice.picker.transcriptPlaceholder")}
                onValueChange={(value) => set("transcript", value)}
              />
            </div>
          </Show>
          <p class="global-voice-hint">{hint()}</p>
        </Show>
      </section>
    </div>
  );

  function PillBody() {
    return (
      <div class="global-voice-pill-body">
        <Show when={state.phase === "listening"}>
          <div class="global-voice-wave" ref={(element) => (waveRoot = element)} aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
        </Show>
        <div class="global-voice-pill-copy">
          <Show
            when={state.error}
            fallback={
              <span class="global-voice-phase" ref={(element) => (phaseNode = element)}>
                {phaseText()}
              </span>
            }
          >
            {(message) => <span class="global-voice-error">{message()}</span>}
          </Show>
          <Show when={state.transcript && state.phase !== "sent"}>
            <span class="global-voice-transcript" dir={globalVoiceTextDirection(state.transcript)}>
              {state.transcript}
            </span>
          </Show>
          <Show when={state.keyRelease === "needs-accessibility" && state.phase !== "sent"}>
            <span class="global-voice-note">{t("globalVoice.picker.accessibilityNeeded")}</span>
          </Show>
          <Show when={state.keyRelease === "unavailable" && state.phase !== "sent"}>
            <span class="global-voice-note">{t("globalVoice.picker.holdUnavailable")}</span>
          </Show>
        </div>
        <Show when={state.phase === "sent" && state.targetId}>
          <Button type="button" variant="ghost" class="global-voice-open" onClick={() => void openChat()}>
            {t("globalVoice.picker.openChat")}
          </Button>
        </Show>
        <Show when={state.errorAction === "microphone"}>
          <Button type="button" variant="ghost" class="global-voice-open" onClick={() => void allowMicrophone()}>
            {t("globalVoice.picker.allowMicrophone")}
          </Button>
        </Show>
        <Show when={state.keyRelease === "needs-accessibility" && state.phase !== "sent"}>
          <Button type="button" variant="ghost" class="global-voice-open" onClick={() => void allowAccessibility()}>
            {t("globalVoice.picker.allowAccessibility")}
          </Button>
        </Show>
      </div>
    );
  }

  async function openChat(): Promise<void> {
    const agentId = state.targetId;
    if (!agentId) return;
    await window.openbot.globalVoice.openChat({ agentId });
    hide();
  }

  async function allowMicrophone(): Promise<void> {
    const next = await window.openbot.globalVoice.openMicrophoneSettings();
    set("keyRelease", next.keyRelease);
    const agentId = state.targetId;
    if (next.microphone === "granted" && agentId) startFor(agentId, state.holdToTalk);
  }

  async function allowAccessibility(): Promise<void> {
    const next = await window.openbot.globalVoice.openAccessibilitySettings();
    setState((draft) => {
      draft.keyRelease = next.keyRelease;
      draft.holdToTalk = next.preference.captureMode === "hold" && next.keyRelease === "ready";
    });
  }

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
              pickerPinned = true;
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
          <section
            class="global-voice-list"
            aria-label={t("globalVoice.picker.list")}
            style={{ "--voice-index": String(state.highlight) }}
          >
            <div class="global-voice-highlight" aria-hidden="true" />
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
                  onPointerEnter={() => {
                    pickerPinned = true;
                    set("highlight", index());
                  }}
                  onClick={() => choose(agent)}
                >
                  <span class="global-voice-avatar" aria-hidden="true">
                    {globalVoiceInitials(agent.name)}
                  </span>
                  <span class="global-voice-option-text">
                    <span class="global-voice-option-name" dir={globalVoiceTextDirection(agent.name)}>
                      {agent.name}
                    </span>
                    <Show when={agent.title}>
                      <span class="global-voice-option-title" dir={globalVoiceTextDirection(agent.title)}>
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
