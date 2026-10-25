import type { GlobalVoiceShortcutStatus } from "@openbot/contracts/ipc";
import { createSignal, Show } from "solid-js";
import { Button } from "../../button";
import { useText } from "../../text";
import { formatGlobalVoiceAccelerator, globalVoiceAcceleratorFromKeyboard, isMacPlatform } from "./global-voice-keys";

export interface GlobalVoiceShortcutFieldProps {
  /** The name of the shortcut, for the button's label. */
  name: string;
  /** The accelerator, or null when none is set. */
  accelerator: string | null;
  /** Whether main registered it. Taken means another app or shortcut holds the key. */
  status?: GlobalVoiceShortcutStatus | undefined;
  /** The value that Reset restores. Reset shows only when the value differs from it. */
  defaultAccelerator?: string | undefined;
  /** Shows a button that clears the shortcut, for an agent shortcut that is optional. */
  clearable?: boolean | undefined;
  disabled?: boolean | undefined;
  onChange: (accelerator: string | null) => void;
}

/**
 * Records a shortcut: the user presses the keys, and the button keeps the combination. Escape keeps
 * the old one. Only a key with a modifier is accepted, as a bare key would take it from every app.
 */
export function GlobalVoiceShortcutField(props: GlobalVoiceShortcutFieldProps) {
  const { t } = useText();
  const [recording, setRecording] = createSignal(false);
  const [message, setMessage] = createSignal<string | null>(null);
  const isMac = isMacPlatform();
  const shown = () =>
    props.accelerator ? formatGlobalVoiceAccelerator(props.accelerator, isMac) : t("globalVoice.agent.none");

  function onKeyDown(event: KeyboardEvent) {
    if (!recording()) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      setRecording(false);
      setMessage(null);
      return;
    }
    const result = globalVoiceAcceleratorFromKeyboard(event, isMac);
    // Only modifiers are held: keep recording until a key comes.
    if (result === null) return;
    if ("error" in result) {
      setMessage(
        t(
          result.error === "needsModifier"
            ? "globalVoice.settings.needsModifier"
            : "globalVoice.settings.keyNotAllowed",
        ),
      );
      return;
    }
    setRecording(false);
    setMessage(null);
    props.onChange(result.accelerator);
  }

  return (
    <div class="global-voice-shortcut-field">
      <div class="global-voice-shortcut-controls">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={props.disabled}
          aria-label={t("globalVoice.settings.recordLabel", { name: props.name })}
          aria-describedby={recording() ? "global-voice-record-hint" : undefined}
          onClick={() => {
            setMessage(null);
            setRecording(true);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => {
            setRecording(false);
            setMessage(null);
          }}
        >
          <kbd dir="ltr">{recording() ? t("globalVoice.settings.record") : shown()}</kbd>
        </Button>
        <Show when={props.defaultAccelerator && props.accelerator !== props.defaultAccelerator}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={props.disabled}
            onClick={() => props.onChange(props.defaultAccelerator ?? null)}
          >
            {t("globalVoice.settings.reset")}
          </Button>
        </Show>
        <Show when={props.clearable && props.accelerator}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={props.disabled}
            onClick={() => props.onChange(null)}
          >
            {t("globalVoice.settings.turnOff")}
          </Button>
        </Show>
      </div>
      <Show when={recording()}>
        <p id="global-voice-record-hint" class="global-voice-shortcut-hint">
          {t("globalVoice.settings.recordHint")}
        </p>
      </Show>
      <Show when={message()}>
        {(text) => (
          <p class="global-voice-shortcut-error" role="alert">
            {text()}
          </p>
        )}
      </Show>
      <Show when={props.status === "taken"}>
        <p class="global-voice-shortcut-error" role="status">
          {t("globalVoice.settings.takenWarning", {
            accelerator: props.accelerator ? formatGlobalVoiceAccelerator(props.accelerator, isMac) : "",
          })}
        </p>
      </Show>
    </div>
  );
}
