import { DiffView } from "@openbot/ui/features/conversation/DiffView";
import type { ChangesFile } from "@openbot/ui/features/conversation/FileRow";
import { render, screen } from "@solidjs/testing-library";
import { expect, it, vi } from "vitest";

const FILE: ChangesFile = { path: "src/notes.md", status: "modified", additions: 2, deletions: 1 };
const DIFF = {
  path: "src/notes.md",
  diff: ["--- a/src/notes.md", "+++ b/src/notes.md", "-old line", "+new line"].join("\n"),
  content: "# Notes\n\nnew line\n",
};

// The file view shows the current file text, not the boolean behind the gate.
it("shows the file text in the file view", async () => {
  const shown = render(() => <DiffView file={FILE} diff={DIFF} view="file" onViewChange={vi.fn()} onBack={vi.fn()} />);
  const body = shown.container.querySelector("pre.changes-file-text");
  expect(body?.textContent ?? "").toContain("# Notes");
  expect(body?.textContent ?? "").toContain("new line");
});

// The diff view keeps naming the removed and added lines.
it("shows the removed and added lines in the diff view", async () => {
  render(() => <DiffView file={FILE} diff={DIFF} view="diff" onViewChange={vi.fn()} onBack={vi.fn()} />);
  expect((await screen.findByText("-old line")).textContent ?? "").toBe("-old line");
  expect((await screen.findByText("+new line")).textContent ?? "").toBe("+new line");
});
