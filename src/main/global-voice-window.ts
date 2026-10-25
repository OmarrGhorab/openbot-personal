// The global voice shortcuts and the window they drive. The dictation shortcut starts dictation to
// the current agent at once, and a second press sends it. The picker shortcut opens a list of
// agents. While the dictation listens, Tab opens the picker and Escape cancels; main registers
// those two keys only while it listens. The window renders the pill, the picker or nothing, and
// records the microphone itself, so the main window is not needed.

import {
  type AgentSummary,
  DEFAULT_GLOBAL_VOICE_PREFERENCE,
  type GlobalVoiceCommand,
  type GlobalVoiceInteractiveInput,
  type GlobalVoiceKeyRelease,
  type GlobalVoicePickerAgent,
  type GlobalVoicePickerRequest,
  type GlobalVoicePickerSnapshot,
  type GlobalVoicePreference,
  type GlobalVoiceSendInput,
  type GlobalVoiceShortcutState,
  type GlobalVoiceShortcutTarget,
  type GlobalVoiceState,
  type GlobalVoiceView,
  type GlobalVoiceViewState,
  IPC_ENDPOINTS,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { Effect, Schema } from "effect";
import type { BrowserWindow } from "electron";
import { causeHelpers } from "../backend/effect-boundary";
import type { GlobalKeyRelease } from "./global-key-release";
import { readGlobalVoicePreference, writeGlobalVoicePreference } from "./global-voice-preference-store";
import { sendToRenderer } from "./renderer-ipc";

const logger = createOpenBotLogger("global-voice");
const SNAPSHOT_RETRY_MS = 50;
const SNAPSHOT_RETRY_LIMIT = 40;

/** Keys that work only while a dictation listens: Tab opens the picker, Escape cancels. */
const LISTENING_KEYS = { choose: "Tab", cancel: "Escape" } as const;

/** A global voice operation that failed. The cause is what the renderer reads. */
export class GlobalVoiceFailed extends Schema.TaggedError<GlobalVoiceFailed>()("GlobalVoiceFailed", {
  cause: Schema.Defect(),
}) {}

export const { rewrap: toGlobalVoiceFailed } = causeHelpers(GlobalVoiceFailed);

/** The part of `globalShortcut` the controller uses. The tests pass a fake. */
export interface GlobalVoiceShortcutRegistry {
  register(accelerator: string, onPress: () => void): boolean;
  unregister(accelerator: string): void;
  unregisterAll(): void;
}

export interface GlobalVoiceControllerOptions {
  preferencePath: string;
  shortcuts: GlobalVoiceShortcutRegistry;
  /** Creates the window, hidden. */
  createWindow: () => BrowserWindow;
  loadWindow: (window: BrowserWindow) => Promise<void>;
  /** Sizes and places the window for the pill (bottom centre) or the picker (upper part). */
  placeWindow: (window: BrowserWindow, view: Exclude<GlobalVoiceView, "hidden">) => void;
  /** The agents on this computer. */
  listAgents: () => AgentSummary[];
  /** Sends a dictated message to an agent on this computer, as the Dynamic Island does. */
  sendTranscript: (agentId: string, text: string) => Effect.Effect<void, GlobalVoiceFailed>;
  /** Reports key-up for hold-to-talk. The controller starts it only while hold mode is on. */
  keyRelease: GlobalKeyRelease;
  /** `denied` only on macOS when Accessibility is off. Other systems return `unsupported`. */
  readAccessibility: () => "granted" | "denied" | "unsupported";
  /** Shows the system prompt and, when it is still missing, the settings pane. */
  promptAccessibility: () => Promise<void>;
  promptMicrophone: () => Promise<void>;
  readMicrophone: () => GlobalVoiceState["microphone"];
  /** Brings the app forward so the island can take the keyboard. */
  activateApp: () => void;
  /** Shows the main window on the agent's chat. */
  openAgentChat: (agentId: string) => void;
}

export class GlobalVoiceController {
  readonly #options: GlobalVoiceControllerOptions;
  #preference: GlobalVoicePreference = structuredClone(DEFAULT_GLOBAL_VOICE_PREFERENCE);
  #shortcuts: GlobalVoiceShortcutState[] = [];
  #window: BrowserWindow | null = null;
  #snapshot: GlobalVoicePickerSnapshot | null = null;
  #view: GlobalVoiceViewState = { view: "hidden", listening: false };
  #listeningKeysRegistered = false;
  /** The agent that the last message went to. Dictation goes there unless the user chooses another. */
  #lastAgentId: string | null = null;
  /** The agent last chosen in the picker in this session, sent or not. It wins over the default. */
  #pickedAgentId: string | null = null;
  #openings = 0;
  #destroyed = false;
  #keyRelease: GlobalVoiceKeyRelease = "ready";
  /** True while Settings is recording a shortcut, so the keys are not also global shortcuts. */
  #capturingShortcut = false;

  constructor(options: GlobalVoiceControllerOptions) {
    this.#options = options;
    options.keyRelease.onRelease((accelerator) => this.#release(accelerator));
  }

  /** Reads the saved preference and registers its shortcuts. Call after the app is ready. */
  readonly initialize = Effect.fn("GlobalVoice.initialize")(function* (this: GlobalVoiceController) {
    this.#preference = yield* readGlobalVoicePreference(this.#options.preferencePath).pipe(toGlobalVoiceFailed);
    this.#registerShortcuts();
  }).bind(this);

  /** The renderer of the window, which the picker requests check. */
  /** The pill and picker window while it exists, so voice model progress can reach it. */
  get window(): BrowserWindow | null {
    return this.#window && !this.#window.isDestroyed() ? this.#window : null;
  }

  get pickerRendererIds(): ReadonlySet<number> {
    return new Set(this.#window && !this.#window.isDestroyed() ? [this.#window.webContents.id] : []);
  }

  getState(): GlobalVoiceState {
    return {
      preference: structuredClone(this.#preference),
      shortcuts: structuredClone(this.#shortcuts),
      keyRelease: this.#keyRelease,
      microphone: this.#options.readMicrophone(),
    };
  }

  /**
   * Pauses every global voice shortcut while a field records a new one, then registers them again.
   * Without the pause, Option+V is eaten by the live shortcut and the field only sees V.
   */
  setCapturingShortcut(capturing: boolean): GlobalVoiceState {
    this.#capturingShortcut = capturing;
    logger.info(
      capturing
        ? "Global voice shortcuts are paused while a shortcut is recorded."
        : "Global voice shortcuts are registered again.",
    );
    this.#registerShortcuts();
    return this.getState();
  }

  /** Saves the preference and registers its shortcuts again. Writes run in the order of the calls. */
  setPreference(preference: GlobalVoicePreference): Effect.Effect<GlobalVoiceState, GlobalVoiceFailed> {
    return Effect.gen({ self: this }, function* () {
      this.#preference = yield* writeGlobalVoicePreference(this.#options.preferencePath, preference).pipe(
        toGlobalVoiceFailed,
      );
      this.#registerShortcuts();
      return this.getState();
    });
  }

  /** The opening that the window reads when it loads, or null when none has been made yet. */
  getPickerSnapshot(): GlobalVoicePickerSnapshot | null {
    return this.#snapshot ? structuredClone(this.#snapshot) : null;
  }

  /** The window reports the view it shows and whether the dictation listens. */
  setView(state: GlobalVoiceViewState): void {
    if (this.#destroyed) return;
    this.#applyView(state);
  }

  /** Sends the dictated text to the agent. The window shows the confirmation and then hides itself. */
  sendTranscript(input: GlobalVoiceSendInput): Effect.Effect<void, GlobalVoiceFailed> {
    return Effect.gen({ self: this }, function* () {
      if (!this.#options.listAgents().some((agent) => agent.id === input.agentId)) {
        return yield* new GlobalVoiceFailed({ cause: new Error(sourceText("error.globalVoice.agentUnavailable")) });
      }
      yield* this.#options.sendTranscript(input.agentId, input.text);
      this.#lastAgentId = input.agentId;
    });
  }

  /**
   * The window reports an agent chosen in the picker. The next dictation shortcut goes to it, also
   * when the picker closes with no message sent. An agent that is not on this computer is ignored.
   */
  selectAgent(agentId: string): void {
    if (this.#destroyed || !this.#options.listAgents().some((agent) => agent.id === agentId)) return;
    this.#pickedAgentId = agentId;
  }

  closePicker(): void {
    this.#applyView({ view: "hidden", listening: false });
  }

  /** The island takes clicks only while the pointer is over it, and the keyboard only for the picker. */
  setInteractive(input: GlobalVoiceInteractiveInput): void {
    const window = this.window;
    if (!window) return;
    window.setIgnoreMouseEvents(!input.interactive, { forward: true });
    window.setFocusable(input.keyboard);
    if (!input.keyboard) return;
    this.#options.activateApp();
    window.show();
    window.focus();
  }

  /** Shows the agent's chat in the main window. The island calls this from its confirmation. */
  openChat(agentId: string): void {
    if (!this.#options.listAgents().some((agent) => agent.id === agentId)) return;
    this.#options.openAgentChat(agentId);
  }

  readonly promptAccessibility = Effect.fn("GlobalVoice.promptAccessibility")(function* (this: GlobalVoiceController) {
    yield* Effect.promise(() => this.#options.promptAccessibility());
    this.#registerShortcuts();
    return this.getState();
  }).bind(this);

  readonly promptMicrophone = Effect.fn("GlobalVoice.promptMicrophone")(function* (this: GlobalVoiceController) {
    yield* Effect.promise(() => this.#options.promptMicrophone());
    return this.getState();
  }).bind(this);

  destroy(): void {
    this.#destroyed = true;
    this.#options.keyRelease.stop();
    this.#options.shortcuts.unregisterAll();
    this.#listeningKeysRegistered = false;
    this.#shortcuts = [];
    if (this.#window && !this.#window.isDestroyed()) this.#window.destroy();
    this.#window = null;
  }

  #registerShortcuts(): void {
    this.#options.shortcuts.unregisterAll();
    this.#listeningKeysRegistered = false;
    const preference = this.#preference;
    const entries: Array<{ target: GlobalVoiceShortcutTarget; accelerator: string }> = [
      { target: { type: "dictation" }, accelerator: preference.accelerator },
      { target: { type: "picker" }, accelerator: preference.pickerAccelerator },
      ...preference.agentShortcuts.map((shortcut) => ({
        target: { type: "agent" as const, agentId: shortcut.agentId },
        accelerator: shortcut.accelerator,
      })),
    ];
    this.#shortcuts = entries.map(({ target, accelerator }) => {
      if (!preference.enabled || this.#capturingShortcut) return { target, accelerator, status: "disabled" };
      return {
        target,
        accelerator,
        status: this.#register(accelerator, () => this.#press(target)) ? "active" : "taken",
      };
    });
    // A listening dictation registers its keys again; the view state is kept by the window.
    if (preference.enabled && this.#view.listening) this.#registerListeningKeys();
    this.#syncKeyRelease();
  }

  /** Starts the key-up hook only for hold mode. Toggle does not need to see the release. */
  #syncKeyRelease(): void {
    const accelerators = this.#shortcuts
      .filter((shortcut) => shortcut.status === "active")
      .map((shortcut) => shortcut.accelerator);
    this.#options.keyRelease.setAccelerators(accelerators, process.platform);
    const access = this.#options.readAccessibility();
    const hold = this.#preference.enabled && this.#preference.captureMode === "hold" && !this.#capturingShortcut;
    if (!hold || access === "denied") {
      this.#options.keyRelease.stop();
      this.#keyRelease = access === "denied" ? "needs-accessibility" : "ready";
      if (this.#preference.captureMode === "hold" && access === "denied") {
        logger.warn("Hold-to-talk needs Accessibility. The shortcut uses a tap until it is allowed.", {
          arch: process.arch,
          platform: process.platform,
        });
      }
      return;
    }
    this.#keyRelease = this.#options.keyRelease.start();
    if (this.#keyRelease === "ready") {
      logger.info("The key-release hook is running.", { arch: process.arch, platform: process.platform });
    } else {
      logger.warn("The key-release hook did not start. The shortcut uses a tap.", {
        arch: process.arch,
        platform: process.platform,
      });
    }
  }

  /** A key-up of a shortcut that is held. The window decides whether that ends the recording. */
  #release(accelerator: string): void {
    if (this.#destroyed || this.#preference.captureMode !== "hold" || this.#keyRelease !== "ready") return;
    const shortcut = this.#shortcuts.find((item) => item.accelerator === accelerator && item.status === "active");
    const window = this.window;
    if (!shortcut || !window?.isVisible()) return;
    const source =
      shortcut.target.type === "picker" ? "picker" : shortcut.target.type === "agent" ? "agent" : "dictation";
    this.#command({ type: "release", source });
  }

  #register(accelerator: string, onPress: () => void): boolean {
    try {
      const registered = this.#options.shortcuts.register(accelerator, onPress);
      if (!registered) logger.warn("A global voice shortcut is taken by another app.", { accelerator });
      else logger.info("A global voice shortcut is registered.", { accelerator });
      return registered;
    } catch (error) {
      logger.warn("A global voice shortcut could not be registered.", { accelerator, error: toLogValue(error) });
      return false;
    }
  }

  #registerListeningKeys(): void {
    if (this.#listeningKeysRegistered) return;
    this.#listeningKeysRegistered = true;
    this.#register(LISTENING_KEYS.choose, () => this.#command({ type: "choose" }));
    this.#register(LISTENING_KEYS.cancel, () => this.#command({ type: "cancel" }));
  }

  #unregisterListeningKeys(): void {
    if (!this.#listeningKeysRegistered) return;
    this.#listeningKeysRegistered = false;
    this.#options.shortcuts.unregister(LISTENING_KEYS.choose);
    this.#options.shortcuts.unregister(LISTENING_KEYS.cancel);
  }

  /** A registered shortcut, or Tab and Escape while listening, becomes a command for the window. */
  #press(target: GlobalVoiceShortcutTarget): void {
    if (this.#destroyed) return;
    logger.info("A global voice shortcut was pressed.", { target: target.type });
    if (target.type === "picker") {
      this.#command({ type: "choose" });
      return;
    }
    if (target.type === "dictation") {
      const agentId = this.#currentAgentId();
      this.#command(agentId ? { type: "agent", agentId } : { type: "choose" });
      return;
    }
    this.#command({ type: "agent", agentId: target.agentId });
  }

  #command(command: GlobalVoiceCommand): void {
    if (command.type === "agent" && !this.#options.listAgents().some((agent) => agent.id === command.agentId)) {
      return;
    }
    const window = this.#ensureWindow();
    if (window.isVisible()) {
      sendToRenderer(window, IPC_ENDPOINTS.globalVoice.pickerShortcut, command);
      return;
    }
    // Cancel, a key release and Tab have nothing to act on while the window is hidden.
    if (command.type === "cancel" || command.type === "release") return;
    this.#open(window, command);
  }

  #open(window: BrowserWindow, request: GlobalVoicePickerRequest): void {
    this.#openings += 1;
    this.#snapshot = {
      id: this.#openings,
      request,
      currentAgentId: this.#currentAgentId(),
      agents: this.#pickerAgents(),
      sendAfterSpeaking: this.#preference.sendAfterSpeaking,
      captureMode: this.#preference.captureMode,
      holdToTalk: this.#preference.captureMode === "hold" && this.#keyRelease === "ready",
      keyRelease: this.#keyRelease,
    };
    const view = request.type === "choose" ? "picker" : "pill";
    this.#applyView({ view, listening: false });
    this.#deliverSnapshot(window);
  }

  /** Sends the opening to the window. A load that has not finished gets it again from did-finish-load. */
  #deliverSnapshot(window: BrowserWindow): boolean {
    if (this.#destroyed || this.#window !== window || window.isDestroyed() || !this.#snapshot) return true;
    const sent = sendToRenderer(window, IPC_ENDPOINTS.globalVoice.pickerOpened, this.#snapshot);
    if (sent) {
      logger.info("The global voice window received its opening.", {
        id: this.#snapshot.id,
        view: this.#view.view,
        visible: window.isVisible(),
      });
      return true;
    }
    logger.warn("The global voice window is not ready for its opening yet.", {
      loading: window.webContents.isLoading(),
      visible: window.isVisible(),
    });
    return false;
  }

  /**
   * did-finish-load can fire while Electron still reports the main frame as loading, so the send
   * is refused. Without a retry the first opening was lost and the window stayed empty.
   */
  #deliverAfterLoad(window: BrowserWindow, attempt = 0): void {
    if (this.#deliverSnapshot(window) || attempt >= SNAPSHOT_RETRY_LIMIT) return;
    setTimeout(() => this.#deliverAfterLoad(window, attempt + 1), SNAPSHOT_RETRY_MS);
  }

  /** Shows the window in a view, and registers Tab and Escape only while the dictation listens. */
  #applyView(state: GlobalVoiceViewState): void {
    this.#view = { view: state.view, listening: state.view !== "hidden" && state.listening };
    if (this.#view.listening) this.#registerListeningKeys();
    else this.#unregisterListeningKeys();
    const window = this.#window;
    if (!window || window.isDestroyed()) return;
    if (state.view === "hidden") {
      window.hide();
      return;
    }
    this.#options.placeWindow(window, state.view);
    // The pill never takes the keyboard, so the app the user works in keeps it. The picker does,
    // for its search field, and takes it without activating OpenBot.
    const picker = state.view === "picker";
    window.setIgnoreMouseEvents(!picker, { forward: true });
    window.setFocusable(picker);
    if (picker) this.#options.activateApp();
    // showInactive does nothing on macOS while the app is in the background. A hidden window is the
    // failure Omar saw: the shortcut logged a press and the island never appeared.
    window.showInactive();
    if (!window.isVisible()) {
      logger.warn("showInactive left the global voice window hidden. Showing it.");
      window.show();
    }
    if (picker) window.focus();
    const bounds = window.getBounds();
    logger.info("The global voice window is on screen.", {
      view: state.view,
      visible: window.isVisible(),
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    });
  }

  #ensureWindow(): BrowserWindow {
    if (this.#window && !this.#window.isDestroyed()) return this.#window;
    const window = this.#options.createWindow();
    this.#window = window;
    window.webContents.on("did-finish-load", () => {
      logger.info("The global voice window finished loading.");
      this.#deliverAfterLoad(window);
    });
    window.webContents.on("did-fail-load", (_event, code, description) => {
      logger.error("The global voice window failed to load.", { code, description });
    });
    window.on("closed", () => {
      if (this.#window === window) this.#window = null;
      this.#view = { view: "hidden", listening: false };
      this.#unregisterListeningKeys();
    });
    this.#options.loadWindow(window).catch((error: unknown) => {
      logger.error("Unable to load the global voice window.", toLogValue(error));
      if (this.#window === window) this.#window = null;
      if (!window.isDestroyed()) window.destroy();
    });
    return window;
  }

  #currentAgentId(): string | null {
    return globalVoiceTargetAgentId(this.#pickerAgents(), {
      picked: this.#pickedAgentId,
      preferred: this.#preference.defaultAgentId,
      last: this.#lastAgentId,
    });
  }

  /** Agents on this computer that the user has not hidden, most recent first. */
  #pickerAgents(): GlobalVoicePickerAgent[] {
    return this.#options
      .listAgents()
      .filter((agent) => !agent.hiddenAt)
      .sort((left, right) => activityTime(right) - activityTime(left))
      .map((agent) => ({ agentId: agent.id, name: agent.name, title: agent.title, updatedAt: agent.updatedAt }));
  }
}

/**
 * The agent that the dictation shortcut targets. The first that is still in `agents` wins:
 * 1. the agent last chosen in the picker in this session (the user's most recent explicit choice),
 * 2. the saved default agent,
 * 3. the agent that got the last message,
 * 4. the most recent agent (the first in `agents`).
 * The picker choice lives in memory only, so the saved default applies again after a restart.
 */
export function globalVoiceTargetAgentId(
  agents: readonly Pick<GlobalVoicePickerAgent, "agentId">[],
  choices: { picked: string | null; preferred: string | null; last: string | null },
): string | null {
  for (const candidate of [choices.picked, choices.preferred, choices.last]) {
    if (candidate && agents.some((agent) => agent.agentId === candidate)) return candidate;
  }
  return agents[0]?.agentId ?? null;
}

function activityTime(agent: Pick<AgentSummary, "updatedAt">): number {
  const time = agent.updatedAt ? Date.parse(agent.updatedAt) : Number.NaN;
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

/** Only the window may call the picker's requests. Every window shares one origin. */
export function requireGlobalVoicePickerSender(actualId: number, expectedIds: ReadonlySet<number>): void {
  if (!expectedIds.has(actualId)) {
    throw new Error("Rejected global voice IPC request outside the picker.");
  }
}
