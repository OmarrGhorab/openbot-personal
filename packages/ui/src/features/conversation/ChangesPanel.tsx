import { Button, X } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { For, Show } from "solid-js";
import { type ChangesFileDiff, type ChangesView, DiffView } from "./DiffView";
import { type ChangesFile, FileRow } from "./FileRow";

/**
 * The Changes pane of the side panel: the files of the turn, newest first, then the diff of the
 * opened file. It lives in the side panel only; the tab closes it. Buttons only, so the panel
 * matches the app and opens no OS popup.
 */
export function ChangesPanel(props: {
  files: readonly ChangesFile[];
  /** Null for the list; a path for its diff. */
  selectedPath: string | null;
  /** Null while the read is in flight. */
  diff: ChangesFileDiff | null;
  view: ChangesView;
  onOpenFile: (path: string) => void;
  onBack: () => void;
  onViewChange: (view: ChangesView) => void;
  onClosePanel: () => void;
}) {
  const { t } = useText();
  const selected = () => props.files.find((file) => file.path === props.selectedPath) ?? null;
  return (
    <aside class="browser-panel changes-panel" aria-label={t("chat.changes.title")}>
      <header class="file-preview-header side-panel-pane-header">
        <h2 class="side-panel-pane-title">{t("chat.changes.title")}</h2>
        <span class="changes-panel-count">{t("chat.steps.files", { count: props.files.length })}</span>
        <Button
          type="button"
          variant="ghost"
          class="browser-toolbar-button side-panel-pane-close"
          aria-label={t("conversation.tasks.panel.closePanel")}
          onClick={() => props.onClosePanel()}
        >
          <X class="browser-toolbar-icon" />
        </Button>
      </header>
      <Show
        when={selected()}
        fallback={
          <Show
            when={props.files.length > 0}
            fallback={
              <span class="changes-empty" role="status">
                {t("chat.changes.empty")}
              </span>
            }
          >
            <ol class="changes-file-list">
              <For each={props.files}>
                {(file) => (
                  <li>
                    <FileRow file={file} selected={false} onOpen={props.onOpenFile} />
                  </li>
                )}
              </For>
            </ol>
          </Show>
        }
      >
        {(file) => (
          <DiffView
            file={file()}
            diff={props.diff}
            view={props.view}
            onViewChange={props.onViewChange}
            onBack={props.onBack}
          />
        )}
      </Show>
    </aside>
  );
}
