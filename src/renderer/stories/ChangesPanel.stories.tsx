import { ChangesPanel } from "@openbot/ui/features/conversation/ChangesPanel";
import type { ChangesFileDiff, ChangesView } from "@openbot/ui/features/conversation/DiffView";
import type { ChangesFile } from "@openbot/ui/features/conversation/FileRow";
import { createSignal } from "solid-js";
import type { Meta, StoryObj } from "storybook-solidjs-vite";

const FILES: ChangesFile[] = [
  { path: "src/notes.md", status: "modified", additions: 12, deletions: 3 },
  { path: "src/plan.md", status: "added", additions: 40 },
  { path: "src/draft.md", status: "deleted", deletions: 8 },
  { path: "src/todo.md", status: "modified" },
];

const DIFF: ChangesFileDiff = {
  path: "src/notes.md",
  diff: [
    "--- a/src/notes.md",
    "+++ b/src/notes.md",
    "@@ -1,4 +1,5 @@",
    " # Notes",
    " ",
    "-old line",
    "+new line",
    "+added line",
    " context",
  ].join("\n"),
  content: "# Notes\n\nnew line\nadded line\ncontext\n",
};

function Panel(props: {
  files: readonly ChangesFile[];
  diff: ChangesFileDiff | null;
  startPath?: string | null;
  startView?: ChangesView;
}) {
  const [path, setPath] = createSignal<string | null>(props.startPath ?? null);
  const [view, setView] = createSignal<ChangesView>(props.startView ?? "diff");
  return (
    <div class="conversation-panel" style={{ width: "420px", height: "560px" }}>
      <ChangesPanel
        files={props.files}
        selectedPath={path()}
        diff={props.diff}
        view={view()}
        onOpenFile={setPath}
        onBack={() => setPath(null)}
        onViewChange={setView}
        onClosePanel={() => undefined}
      />
    </div>
  );
}

const meta = {
  title: "Conversation/ChangesPanel",
  parameters: { layout: "padded" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** A turn that changed no files. */
export const Empty: Story = {
  render: () => <Panel files={[]} diff={null} />,
};

/** The files of a turn, newest first. Opening a row shows its diff. */
export const List: Story = {
  render: () => <Panel files={FILES} diff={null} />,
};

/** The diff of the opened file, with Diff/File views and a Back button. */
export const Diff: Story = {
  render: () => <Panel files={FILES} diff={DIFF} startPath="src/notes.md" />,
};

/** The current text of the opened file. */
export const File: Story = {
  render: () => <Panel files={FILES} diff={DIFF} startPath="src/notes.md" startView="file" />,
};

/** The diff is still loading: the view names the wait. */
export const Loading: Story = {
  render: () => <Panel files={FILES} diff={null} startPath="src/notes.md" />,
};
