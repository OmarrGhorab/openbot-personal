import { MonitorCanvasBoard, type MonitorCanvasNode } from "@openbot/ui/features/monitor/MonitorCanvasBoard";
import { render, screen } from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const node = (id: string, x: number): MonitorCanvasNode => ({
  id,
  position: { x, y: 0 },
  card: { agent: { avatarSeed: id, avatarHue: null, avatarUrl: null }, name: id, status: "working" },
});

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private readonly report: () => void) {}
      observe() {
        queueMicrotask(this.report);
      }
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(180);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// A card leaves the canvas when the channel changes or a filter hides its agent. Its cleanup
// forgot its height with a store write inside the list's owned scope, which halted the reactive
// system, so no view of the Monitor updated after that.
it("keeps updating after a card leaves the canvas", async () => {
  const [nodes, setNodes] = createSignal<MonitorCanvasNode[]>([node("chief", 0), node("builder", 400)]);
  const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
  render(() => (
    <MonitorCanvasBoard
      label="Canvas"
      nodes={nodes()}
      edges={[]}
      selectedId={null}
      onSelectNode={() => undefined}
      onOpenEdge={() => undefined}
    />
  ));
  expect(await screen.findByText("builder")).toBeTruthy();

  await new Promise((resolve) => setTimeout(resolve, 0));
  setNodes([node("chief", 0)]);
  expect(() => flush()).not.toThrow();
  await new Promise((resolve) => setTimeout(resolve, 0));
  setNodes([node("chief", 0), node("research", 400)]);
  flush();

  expect(screen.queryByText("research")).toBeTruthy();
  expect(screen.queryByText("builder")).toBeNull();
  expect(errors.mock.calls.flat().join(" ")).not.toContain("REACTIVITY_HALTED");
});
