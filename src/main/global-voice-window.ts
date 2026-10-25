// The global voice shortcuts and the window they drive. The dictation shortcut starts dictation to
// the current agent at once, and a second press sends it. The picker shortcut opens a list of
// agents. While the dictation listens, Tab opens the picker and Escape cancels; main registers
// those two keys only while it listens. The window renders the pill, the picker or nothing, and
// records the microphone itself, so the main window is not needed.

import {
  type AgentSummary,
  DEFAULT_GLOBAL_VOICE_PREFERENCE,
  type GlobalVoiceCommand,
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
import { readGlobalVoicePreference, writeGlobalVoicePreference } from "./global-voice-preference-store";
import { sendToRenderer } from "./renderer-ipc";

const logger = createOpenBotLogger("global-voice");

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
  #openings = 0;
  #destroyed = false;

  constructor(options: GlobalVoiceControllerOptions) {
    this.#options = options;
  }

  /** Reads the saved preference and registers its shortcuts. Call after the app is ready. */
  readonly initialize = Effect.fn("GlobalVoice.initialize")(function* (this: GlobalVoiceController) {
    this.#preference = yield* readGlobalVoicePreference(this.#options.preferencePath).pipe(toGlobalVoiceFailed);
    this.#registerShortcuts();
  }).bind(this);

  /** The renderer of the window, which the picker requests check. */
  get pickerRendererIds(): ReadonlySet<number> {
    return new Set(this.#window && !this.#window.isDestroyed() ? [this.#window.webContents.id] : []);
  }

  getState(): GlobalVoiceState {
    return { preference: structuredClone(this.#preference), shortcuts: structuredClone(this.#shortcuts) };
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

  closePicker(): void {
    this.#applyView({ view: "hidden", listening: false });
  }

  destroy(): void {
    this.#destroyed = true;
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
      if (!preference.enabled) return { target, accelerator, status: "disabled" };
      return {
        target,
        accelerator,
        status: this.#register(accelerator, () => this.#press(target)) ? "active" : "taken",
      };
    });
    // A listening dictation registers its keys again; the view state is kept by the window.
    if (preference.enabled && this.#view.listening) this.#registerListeningKeys();
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
    // Cancel and Tab have nothing to act on while the window is hidden.
    if (command.type === "cancel") return;
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
    };
    this.#applyView({ view: request.type === "choose" ? "picker" : "pill", listening: false });
    if (!window.webContents.isLoading()) sendToRenderer(window, IPC_ENDPOINTS.globalVoice.pickerOpened, this.#snapshot);
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
    window.setFocusable(state.view === "picker");
    if (state.view === "picker") {
      window.show();
      window.focus();
    } else {
      window.showInactive();
    }
  }

  #ensureWindow(): BrowserWindow {
    if (this.#window && !this.#window.isDestroyed()) return this.#window;
    const window = this.#options.createWindow();
    this.#window = window;
    window.webContents.on("did-finish-load", () => {
      if (this.#window !== window || window.isDestroyed() || !window.isVisible() || !this.#snapshot) return;
      sendToRenderer(window, IPC_ENDPOINTS.globalVoice.pickerOpened, this.#snapshot);
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

  /** The last agent that got a message, if it is still on this computer; otherwise the most recent. */
  #currentAgentId(): string | null {
    const agents = this.#pickerAgents();
    if (this.#lastAgentId && agents.some((agent) => agent.agentId === this.#lastAgentId)) return this.#lastAgentId;
    return agents[0]?.agentId ?? null;
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
