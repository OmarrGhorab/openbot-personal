import { describe, expect, it } from "vitest";
import { caretOnEdgeLine } from "./composer-dom";
import { composerSentHistory, idleComposerHistory, stepComposerHistory } from "./composer-history";

describe("composer sent-message history", () => {
  it("drops blank texts and a message sent twice in a row", () => {
    expect(composerSentHistory(["one", "  ", "two", "two", "one", ""])).toEqual(["one", "two", "one"]);
  });

  it("keeps the draft, walks to the oldest, and brings the draft back", () => {
    const sent = ["first", "second"];
    const up = stepComposerHistory(sent, idleComposerHistory(), "older", "my draft");
    expect(up?.value).toBe("second");
    const older = up && stepComposerHistory(sent, up.state, "older", up.value);
    expect(older?.value).toBe("first");
    const oldest = older && stepComposerHistory(sent, older.state, "older", older.value);
    expect(oldest?.value).toBe("first");
    const down = oldest && stepComposerHistory(sent, oldest.state, "newer", oldest.value);
    expect(down?.value).toBe("second");
    const draft = down && stepComposerHistory(sent, down.state, "newer", down.value);
    expect(draft?.value).toBe("my draft");
    expect(draft?.state.index).toBeNull();
  });

  it("leaves the keys alone without history or when Down starts from the draft", () => {
    expect(stepComposerHistory([], idleComposerHistory(), "older", "")).toBeNull();
    expect(stepComposerHistory(["first"], idleComposerHistory(), "newer", "draft")).toBeNull();
  });

  it("finds the caret on the first and last lines of the draft", () => {
    const editor = document.createElement("div");
    document.body.append(editor);
    expect(caretOnEdgeLine(editor, "first")).toBe(true);
    editor.textContent = "one\ntwo\nthree";
    const text = editor.firstChild;
    if (!text) throw new Error("The editor has no text.");
    const placeCaret = (offset: number) => {
      const range = document.createRange();
      range.setStart(text, offset);
      range.collapse(true);
      document.getSelection()?.removeAllRanges();
      document.getSelection()?.addRange(range);
    };
    placeCaret(2);
    expect(caretOnEdgeLine(editor, "first")).toBe(true);
    expect(caretOnEdgeLine(editor, "last")).toBe(false);
    placeCaret(5);
    expect(caretOnEdgeLine(editor, "first")).toBe(false);
    expect(caretOnEdgeLine(editor, "last")).toBe(false);
    placeCaret(10);
    expect(caretOnEdgeLine(editor, "last")).toBe(true);
    editor.remove();
  });
});
