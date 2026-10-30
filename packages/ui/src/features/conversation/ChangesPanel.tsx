import { Button } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { For, Show } from "solid-js";
import { type ChangesFileDiff, type ChangesView, DiffView } from "./DiffView";
import { type ChangesFile, FileRow } from "./FileRow";

/**
 * The Changes pane: the files of the turn, newest first, then the diff of the opened file. While
 * minimized the pane is one row with the file count, so a finished turn keeps its line. Buttons
 * only, so the panel matches the app and opens no OS popup.
 */
export function ChangesPanel(props: {
  files: readonly ChangesFile[];
  /** Null for the list; a path for its diff. */
  selectedPath: string | null;
  /** Null while the read is in flight. */
  diff: ChangesFileDiff | null;
  view: ChangesView;
  minimized: boolean;
  onOpenFile: (path: string) => void;
  onBack: () => void;
  onViewChange: (view: ChangesView) => void;
  onToggleMinimized: () => void;
}) {
  const { t } = useText();
  const selected = () => props.files.find((file) => file.path === props.selectedPath) ?? null;
  return (
    <section class="changes-panel" aria-label={t("chat.changes.title")}>
      <Show
        when={!props.minimized}
        fallback={
          <Button
            variant="ghost"
            type="button"
            class="changes-minimized"
            aria-expanded="false"
            onClick={() => props.onToggleMinimized()}
          >
            <span class="changes-minimized-count">{t("chat.steps.files", { count: props.files.length })}</span>
            <span class="changes-minimized-expand">{t("chat.changes.expand")}</span>
          </Button>
        }
      >
        <div class="changes-panel-header">
          <span class="changes-panel-title">{t("chat.changes.title")}</span>
          <span class="changes-panel-count">{t("chat.steps.files", { count: props.files.length })}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            type="button"
            aria-label={t("chat.changes.minimize")}
            title={t("chat.changes.minimize")}
            aria-pressed="false"
            onClick={() => props.onToggleMinimized()}
          >
            <span aria-hidden="true">–</span>
          </Button>
        </div>
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
            <DiffView file={file()} diff={props.diff} view={props.view} onViewChange={props.onViewChange} onBack={props.onBack} />
          )}
        </Show>
      </Show>
    </section>
  );
}
