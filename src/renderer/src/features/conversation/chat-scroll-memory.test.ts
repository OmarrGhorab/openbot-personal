import { describe, expect, it } from "vitest";
import { createChatScrollMemory, openChatAt } from "./chat-scroll-memory";

const box = (scrollTop: number, scrollHeight = 5000, clientHeight = 800) => ({ scrollTop, scrollHeight, clientHeight });

describe("chat scroll position on a chat switch", () => {
  it("opens a chat at the newest message, not at the top", () => {
    const element = box(0);
    openChatAt(element);
    expect(element.scrollTop).toBe(4200);
  });

  it("opens a short chat at the top, because it does not scroll", () => {
    const element = box(0, 600);
    openChatAt(element);
    expect(element.scrollTop).toBe(0);
  });

  it("keeps the place of a chat that the reader left above the bottom", () => {
    const memory = createChatScrollMemory();
    memory.remember("local:a", box(1000), true);
    memory.remember("local:b", box(4200), false);
    expect(memory.place("local:a")).toBe(3200);
    expect(memory.place("local:b")).toBeUndefined();

    // A page of older messages loaded above: the same messages stay in view.
    const element = box(0, 9000);
    openChatAt(element, memory.place("local:a"));
    expect(element.scrollTop).toBe(5000);
  });

  it("forgets the place when the reader goes back to the bottom", () => {
    const memory = createChatScrollMemory();
    memory.remember("local:a", box(1000), true);
    memory.remember("local:a", box(4200), false);
    expect(memory.place("local:a")).toBeUndefined();
  });

  it("keeps a place for each server and agent", () => {
    const memory = createChatScrollMemory();
    memory.remember("local:a", box(1000), true);
    memory.remember("remote:a", box(2000), true);
    expect(memory.place("local:a")).toBe(3200);
    expect(memory.place("remote:a")).toBe(2200);
  });

  it("drops the oldest place after the limit", () => {
    const memory = createChatScrollMemory(2);
    memory.remember("local:a", box(0), true);
    memory.remember("local:b", box(0), true);
    memory.remember("local:c", box(0), true);
    expect(memory.place("local:a")).toBeUndefined();
    expect(memory.place("local:c")).toBe(4200);
  });
});
