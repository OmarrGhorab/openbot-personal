import type { AppTextKey } from "@openbot/i18n";
import { Button, FilePen } from "@openbot/ui";
import { useText } from "@openbot/ui/text";
import { Show } from "solid-js";

const FILE_STATUS_LABEL = {
  added: "chat.steps.fileAdded",
  modified: "chat.steps.fileModified",
  deleted: "chat.steps.fileDeleted",
} as const satisfies Record<ChangesFile["status"], AppTextKey>;

/** One file of a turn, as the traces and the live steps both carry it. */
export interface ChangesFile {
  path: string;
  status: "added" | "modified" | "deleted";
  additions?: number | undefined;
  deletions?: number | undefined;
}

/** One row of the Changes panel. A Button, so the whole row is one tab stop. */
export function FileRow(props: { file: ChangesFile; selected: boolean; onOpen: (path: string) => void }) {
  const { t } = useText();
  return (
    <Button
      variant="ghost"
      type="button"
      class="changes-file-row"
      data-status={props.file.status}
      aria-current={props.selected ? "true" : undefined}
      title={props.file.path}
      onClick={() => props.onOpen(props.file.path)}
    >
      <FilePen class="changes-file-icon" aria-hidden="true" />
      <span class="changes-file-path">{props.file.path}</span>
      <span class="changes-file-counts">
        <Show when={props.file.additions !== undefined && props.file.additions > 0}>
          <span class="changes-file-additions">+{props.file.additions}</span>
        </Show>
        <Show when={props.file.deletions !== undefined && props.file.deletions > 0}>
          <span class="changes-file-deletions">-{props.file.deletions}</span>
        </Show>
        <Show when={props.file.additions === undefined && props.file.deletions === undefined}>
          <span class="changes-file-status">{t(FILE_STATUS_LABEL[props.file.status])}</span>
        </Show>
      </span>
    </Button>
  );
}
