import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgentSummary,
  DEFAULT_GLOBAL_VOICE_PREFERENCE,
  type GlobalVoicePreference,
  toGlobalVoicePreference,
} from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { BrowserWindow } from "electron";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: class {},
  globalShortcut: {},
  app: {},
}));

const { GlobalVoiceController, globalVoiceTargetAgentId, requireGlobalVoicePickerSender } = await import(
  "./global-voice-window"
);
const { parseGlobalVoiceSendInput, parseGlobalVoiceViewState } = await import("./ipc/global-voice-inputs");

describe("global voice picker sender", () => {
  it("accepts the window's own renderer only", () => {
    const pickerIds = new Set([7]);
    expect(() => requireGlobalVoicePickerSender(7, pickerIds)).not.toThrow();
    expect(() => requireGlobalVoicePickerSender(8, pickerIds)).toThrow();
    expect(() => requireGlobalVoicePickerSender(7, new Set())).toThrow();
  });
});

describe("global voice inputs", () => {
  it("refuses a key with no modifier, and a key or modifier it does not know", () => {
    const base = { enabled: true, pickerAccelerator: "Alt+Shift+Space", sendAfterSpeaking: true, agentShortcuts: [] };
    expect(toGlobalVoicePreference({ ...base, accelerator: "V" })).toBeNull();
    expect(toGlobalVoicePreference({ ...base, accelerator: "F8" })).toBeNull();
    expect(toGlobalVoicePreference({ ...base, accelerator: "Alt+V" })).not.toBeNull();
    expect(toGlobalVoicePreference({ ...base, accelerator: "Control+Space" })).not.toBeNull();
    expect(toGlobalVoicePreference({ ...base, accelerator: "Hyper+V" })).toBeNull();
    expect(toGlobalVoicePreference({ ...base, accelerator: "Alt+Alt+V" })).toBeNull();
    expect(toGlobalVoicePreference({ ...base, accelerator: "VolumeUp" })).toBeNull();
  });

  it("refuses a duplicate agent shortcut", () => {
    const base = {
      enabled: true,
      accelerator: "Control+Space",
      pickerAccelerator: "Alt+Space",
      sendAfterSpeaking: true,
    };
    const shortcut = { agentId: "agent-1", accelerator: "Control+Shift+K" };
    expect(toGlobalVoicePreference({ ...base, agentShortcuts: [shortcut, shortcut] })).toBeNull();
  });

  it("keeps a saved preference that has no hold mode or default agent", () => {
    const saved = {
      enabled: true,
      accelerator: "Alt+V",
      pickerAccelerator: "Alt+K",
      sendAfterSpeaking: true,
      agentShortcuts: [],
    };
    expect(toGlobalVoicePreference(saved)).toMatchObject({ captureMode: "hold", defaultAgentId: null });
    expect(toGlobalVoicePreference({ ...saved, captureMode: "toggle", defaultAgentId: "agent-1" })).toMatchObject({
      captureMode: "toggle",
      defaultAgentId: "agent-1",
    });
    expect(toGlobalVoicePreference({ ...saved, captureMode: "push" })).toBeNull();
    expect(toGlobalVoicePreference({ ...saved, defaultAgentId: "" })).toBeNull();
  });

  it("refuses an empty transcript and an unknown view", () => {
    expect(() => parseGlobalVoiceSendInput({ agentId: "agent-1", text: "   " })).toThrow();
    expect(() => parseGlobalVoiceViewState({ view: "everywhere", listening: false })).toThrow();
    expect(parseGlobalVoiceViewState({ view: "pill", listening: true })).toEqual({ view: "pill", listening: true });
  });
});

describe("global voice target agent", () => {
  const agents = [{ agentId: "recent" }, { agentId: "default" }, { agentId: "last" }, { agentId: "picked" }];

  it("targets the agent chosen in the picker before the default, the last sent and the most recent", () => {
    expect(globalVoiceTargetAgentId(agents, { picked: "picked", preferred: "default", last: "last" })).toBe("picked");
    expect(globalVoiceTargetAgentId(agents, { picked: null, preferred: "default", last: "last" })).toBe("default");
    expect(globalVoiceTargetAgentId(agents, { picked: null, preferred: null, last: "last" })).toBe("last");
    expect(globalVoiceTargetAgentId(agents, { picked: null, preferred: null, last: null })).toBe("recent");
  });

  it("skips a choice whose agent is no longer on this computer", () => {
    expect(globalVoiceTargetAgentId(agents, { picked: "gone", preferred: "default", last: "last" })).toBe("default");
    expect(globalVoiceTargetAgentId(agents, { picked: "gone", preferred: "gone", last: "gone" })).toBe("recent");
    expect(globalVoiceTargetAgentId([], { picked: "picked", preferred: null, last: null })).toBeNull();
  });
});

describe("global voice shortcut registration and dispatch", () => {
  const agent = {
    id: "agent-1",
    name: "Ada",
    title: "",
    updatedAt: null,
    avatarSeed: "ada",
    avatarHue: 120,
    avatarUrl: null,
    hiddenAt: null,
    // The controller reads only these fields of an agent; the rest of the summary is not needed here.
    // biome-ignore lint/nursery/noUnsafeTypeAssertion: A test fake carries only the fields the controller reads.
  } as unknown as AgentSummary;

  /** A controller with a fake shortcut registry. `bound` holds the handler of each registered accelerator. */
  function setup(
    options: { agents?: AgentSummary[]; taken?: string[]; sendTranscript?: () => Effect.Effect<void, never> } = {},
  ) {
    const bound = new Map<string, () => void>();
    const shortcuts = {
      register: vi.fn((accelerator: string, onPress: () => void) => {
        if (options.taken?.includes(accelerator)) return false;
        bound.set(accelerator, onPress);
        return true;
      }),
      unregister: vi.fn((accelerator: string) => {
        bound.delete(accelerator);
      }),
      unregisterAll: vi.fn(() => bound.clear()),
    };
    const contents = {
      id: 7,
      on: vi.fn(),
      send: vi.fn(),
      isDestroyed: () => false,
      isLoadingMainFrame: () => false,
      isLoading: () => false,
      mainFrame: { isDestroyed: () => false, detached: false },
    };
    const window = {
      isDestroyed: () => false,
      // Hidden at first, so a press opens the window rather than sending the command to it.
      isVisible: () => false,
      show: vi.fn(),
      showInactive: vi.fn(),
      hide: vi.fn(),
      focus: vi.fn(),
      destroy: vi.fn(),
      setIgnoreMouseEvents: vi.fn(),
      setFocusable: vi.fn(),
      getBounds: () => ({ x: 0, y: 0, width: 520, height: 520 }),
      on: vi.fn(),
      webContents: contents,
    };
    // biome-ignore lint/nursery/noUnsafeTypeAssertion: A test fake carries only the methods the controller calls.
    const createWindow = vi.fn(() => window as unknown as BrowserWindow);
    const controller = new GlobalVoiceController({
      preferencePath: join(mkdtempSync(join(tmpdir(), "global-voice-")), "preference.json"),
      shortcuts,
      createWindow,
      loadWindow: vi.fn(async () => {}),
      placeWindow: vi.fn(),
      listAgents: () => options.agents ?? [],
      sendTranscript: options.sendTranscript ?? (() => Effect.void),
      keyRelease: {
        start: vi.fn(() => "ready" as const),
        stop: vi.fn(),
        setAccelerators: vi.fn(),
        onRelease: vi.fn(),
      },
      readAccessibility: () => "unsupported",
      promptAccessibility: vi.fn(async () => {}),
      promptMicrophone: vi.fn(async () => {}),
      readMicrophone: () => "granted",
      openAgentChat: vi.fn(),
    });
    return { bound, shortcuts, createWindow, contents, controller };
  }

  function preference(overrides: Partial<GlobalVoicePreference> = {}): GlobalVoicePreference {
    return { ...DEFAULT_GLOBAL_VOICE_PREFERENCE, ...overrides };
  }

  it("registers each shortcut and reports the one another app already holds", async () => {
    const { controller } = setup({ taken: [DEFAULT_GLOBAL_VOICE_PREFERENCE.pickerAccelerator] });
    await Effect.runPromise(controller.setPreference(preference()));
    const statuses = Object.fromEntries(
      controller.getState().shortcuts.map((shortcut) => [shortcut.target.type, shortcut.status]),
    );
    expect(statuses).toEqual({ dictation: "active", picker: "taken" });
  });

  it("pauses every shortcut while one is recorded, then registers them again", async () => {
    const { bound, shortcuts, controller } = setup();
    await Effect.runPromise(controller.setPreference(preference()));
    expect(bound.size).toBe(2);

    controller.setCapturingShortcut(true);
    expect(bound.size).toBe(0);
    expect(shortcuts.unregisterAll).toHaveBeenCalled();
    expect(controller.getState().shortcuts.every((shortcut) => shortcut.status === "disabled")).toBe(true);

    controller.setCapturingShortcut(false);
    expect(bound.size).toBe(2);
    expect(controller.getState().shortcuts.every((shortcut) => shortcut.status === "active")).toBe(true);
  });

  it("drops an agent shortcut for an agent that is not on this computer", async () => {
    const shortcut = { agentId: "gone", accelerator: "Control+Shift+K" };
    const { bound, createWindow, controller } = setup({ agents: [agent] });
    await Effect.runPromise(controller.setPreference(preference({ agentShortcuts: [shortcut] })));

    bound.get(shortcut.accelerator)?.();
    expect(createWindow).not.toHaveBeenCalled();
  });

  it("opens the picker window and sends it the opening when the picker shortcut is pressed", async () => {
    const { bound, createWindow, contents, controller } = setup({ agents: [agent] });
    await Effect.runPromise(controller.setPreference(preference()));

    bound.get(DEFAULT_GLOBAL_VOICE_PREFERENCE.pickerAccelerator)?.();
    expect(createWindow).toHaveBeenCalledTimes(1);
    expect(contents.send).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ request: { type: "choose" } }),
    );
  });

  it("opens the island for an agent shortcut and sends it that agent", async () => {
    const shortcut = { agentId: "agent-1", accelerator: "Control+Shift+K" };
    const { bound, contents, controller } = setup({ agents: [agent] });
    await Effect.runPromise(controller.setPreference(preference({ agentShortcuts: [shortcut] })));

    bound.get(shortcut.accelerator)?.();
    expect(contents.send).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ request: { type: "agent", agentId: "agent-1" } }),
    );
  });

  it("fails a send that never answers, so the island leaves sending with an error", async () => {
    vi.useFakeTimers();
    try {
      const { controller } = setup({ agents: [agent], sendTranscript: () => Effect.never });
      const outcome = controller.sendTranscript({ agentId: agent.id, text: "hello" }).pipe(
        Effect.match({
          onFailure: (error) => error,
          onSuccess: () => null,
        }),
      );
      const promise = Effect.runPromise(outcome);
      await vi.advanceTimersByTimeAsync(20_000);
      const failure = await promise;
      expect(failure).not.toBeNull();
      if (failure === null) throw new Error("The send did not fail.");
      expect(failure.cause).toBeInstanceOf(Error);
      expect(String(failure.cause)).toContain("may still arrive");
    } finally {
      vi.useRealTimers();
    }
  });
});
