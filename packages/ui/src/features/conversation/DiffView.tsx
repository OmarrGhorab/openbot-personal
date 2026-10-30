import { Button, ChevronLeft } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { For, Show } from "solid-js";
import type { ChangesFile } from "./FileRow";

/** The diff and the text of one file, as the read endpoint answers them. */
export interface ChangesFileDiff {
  path: string;
  diff: string;
  content?: string | undefined;
}

export type ChangesView = "diff" | "file";

/**
 * One file of the Changes panel: a Back button, the path, Diff/File view buttons, and the diff
 * or the file text. Buttons only, so the panel matches the app and opens no OS popup.
 */
export function DiffView(props: {
  file: ChangesFile;
  /** Null while the read is in flight. */
  diff: ChangesFileDiff | null;
  view: ChangesView;
  onViewChange: (view: ChangesView) => void;
  onBack: () => void;
}) {
  const { t } = useText();
  return (
    <section class="changes-diff" aria-label={props.file.path}>
      <div class="changes-diff-header">
        <Button
          variant="ghost"
          size="icon-sm"
          type="button"
          aria-label={t("chat.changes.back")}
          title={t("chat.changes.back")}
          onClick={() => props.onBack()}
        >
          <ChevronLeft aria-hidden="true" />
        </Button>
        <span class="changes-diff-path" title={props.file.path}>
          {props.file.path}
        </span>
        <div class="changes-diff-views" role="group" aria-label={t("chat.changes.title")}>
          <Button
            variant={props.view === "diff" ? "secondary" : "ghost"}
            type="button"
            aria-pressed={props.view === "diff" ? "true" : "false"}
            onClick={() => props.onViewChange("diff")}
          >
            {t("chat.changes.diff")}
          </Button>
          <Button
            variant={props.view === "file" ? "secondary" : "ghost"}
            type="button"
            aria-pressed={props.view === "file" ? "true" : "false"}
            onClick={() => props.onViewChange("file")}
          >
            {t("chat.changes.file")}
          </Button>
        </div>
      </div>
      <div class="changes-diff-body">
        <Show
          when={props.diff}
          fallback={
            <span class="changes-diff-empty" role="status">
              {t("chat.changes.noDiff")}
            </span>
          }
        >
          {(loaded) => (
            <Show
              when={props.view === "file"}
              fallback={
                <Show
                  when={loaded().diff.trim() !== ""}
                  fallback={
                    <span class="changes-diff-empty" role="status">
                      {t("chat.changes.noDiff")}
                    </span>
                  }
                >
                  <pre class="changes-diff-text">
                    <For each={loaded().diff.split("\n")}>
                      {(line) => <span data-line={diffLineKind(line)}>{line}</span>}
                    </For>
                  </pre>
                </Show>
              }
            >
              <Show
                when={loaded().content !== undefined}
                fallback={
                  <span class="changes-diff-empty" role="status">
                    {t("chat.changes.noDiff")}
                  </span>
                }
              >
                {(content) => <pre class="changes-file-text">{content()}</pre>}
              </Show>
            </Show>
          )}
        </Show>
      </div>
    </section>
  );
}

function diffLineKind(line: string): "add" | "remove" | "hunk" | "context" {
  if (line.startsWith("+") && !line.startsWith("+++")) return "add";
  if (line.startsWith("-") && !line.startsWith("---")) return "remove";
  if (line.startsWith("@")) return "hunk";
  return "context";
}
