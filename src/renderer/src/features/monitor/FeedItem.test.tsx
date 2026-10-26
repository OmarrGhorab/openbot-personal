import { FeedItem } from "@openbot/ui/features/monitor/FeedItem";
import type { MonitorStatus } from "@openbot/ui/features/monitor/monitor-status";
import { render } from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";
import { expect, it, vi } from "vitest";

// The feed shows each agent's face for its status. The mood was a conditional prop, which the
// compiler turns into a memo that the avatar first read inside the Bloub engine's tracked effect;
// creating it there halted the reactive system (PRIMITIVE_IN_FORBIDDEN_SCOPE), and from then on
// no Monitor view, Tasks included, updated.
it("keeps updating when an agent's status changes in the feed", () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const [status, setStatus] = createSignal<MonitorStatus | undefined>(undefined);
  const [text, setText] = createSignal("first");
  const view = render(() => (
    <FeedItem
      agent={{ avatarSeed: "chief", avatarHue: null, avatarUrl: null }}
      actor="Chief"
      text={text()}
      status={status()}
    />
  ));
  expect(() => flush()).not.toThrow();
  setStatus("working");
  expect(() => flush()).not.toThrow();
  setStatus("waiting");
  setText("second");
  expect(() => flush()).not.toThrow();
  expect(view.container.textContent).toContain("second");
  expect(errors.mock.calls.flat().join(" ")).not.toMatch(/REACTIVITY_HALTED|FORBIDDEN_SCOPE/);
  errors.mockRestore();
});
