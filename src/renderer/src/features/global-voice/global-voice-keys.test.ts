import { describe, expect, it } from "vitest";
import { globalVoiceAcceleratorFromKeyboard } from "../../../../../packages/ui/src/features/global-voice/global-voice-keys";

describe("global voice shortcut recording", () => {
  it("keeps Option when the event reports it only through getModifierState", () => {
    const result = globalVoiceAcceleratorFromKeyboard(
      {
        code: "KeyV",
        key: "√",
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        getModifierState: (name) => name === "Alt",
      },
      true,
    );
    expect(result).toEqual({ accelerator: "Alt+V" });
  });

  it("refuses a letter with no modifier", () => {
    const result = globalVoiceAcceleratorFromKeyboard(
      { code: "KeyV", key: "v", altKey: false, ctrlKey: false, metaKey: false, shiftKey: false },
      true,
    );
    expect(result).toEqual({ error: "modifierRequired" });
  });

  it("waits while only Option is held", () => {
    expect(
      globalVoiceAcceleratorFromKeyboard(
        { code: "AltLeft", key: "Alt", altKey: true, ctrlKey: false, metaKey: false, shiftKey: false },
        true,
      ),
    ).toBeNull();
  });
});
