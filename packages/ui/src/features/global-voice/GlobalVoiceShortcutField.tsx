import type { GlobalVoiceShortcutStatus } from "@openbot/contracts/ipc";
import { createSignal, For, Show } from "solid-js";
import { Button } from "../../button";
import { Kbd } from "../../surface";
import { useText } from "../../text";
import {
  formatGlobalVoiceAccelerator,
  globalVoiceAcceleratorFromKeyboard,
  globalVoiceAcceleratorKeys,
  isBareTypingKey,
  isMacPlatform,
} from "./global-voice-keys";
import "./global-voice-shortcut.css";

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
  /** Tells main to pause the live shortcuts while this field records, then register them again. */
  onCaptureChange?: ((capturing: boolean) => void) | undefined;
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
  const keys = () => (props.accelerator ? globalVoiceAcceleratorKeys(props.accelerator, isMac) : []);
  let recorder: HTMLButtonElement | undefined;
  const startRecording = () => {
    setMessage(null);
    if (!recording()) props.onCaptureChange?.(true);
    setRecording(true);
    recorder?.focus();
  };
  const stopRecording = () => {
    if (recording()) props.onCaptureChange?.(false);
    setRecording(false);
    setMessage(null);
  };

  function onKeyDown(event: KeyboardEvent) {
    if (!recording()) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      stopRecording();
      return;
    }
    const result = globalVoiceAcceleratorFromKeyboard(event, isMac);
    // Only modifiers are held: keep recording until a key comes.
    if (result === null) return;
    if ("error" in result) {
      setMessage(
        t(
          result.error === "modifierRequired"
            ? "globalVoice.settings.modifierRequired"
            : "globalVoice.settings.keyNotAllowed",
        ),
      );
      return;
    }
    stopRecording();
    props.onChange(result.accelerator);
  }

  return (
    <div class="global-voice-shortcut-field">
      <div class="global-voice-shortcut-controls">
        <Button
          ref={recorder}
          type="button"
          variant="outline"
          size="sm"
          class="global-voice-shortcut-keys"
          data-recording={recording() ? "" : undefined}
          disabled={props.disabled}
          aria-label={t("globalVoice.settings.recordLabel", { name: props.name })}
          aria-describedby={recording() ? "global-voice-record-hint" : undefined}
          onClick={startRecording}
          onKeyDown={onKeyDown}
          onBlur={stopRecording}
        >
          <Show
            when={!recording()}
            fallback={<span class="global-voice-shortcut-prompt">{t("globalVoice.settings.record")}</span>}
          >
            <Show when={keys().length > 0} fallback={<span>{t("globalVoice.agent.none")}</span>}>
              <span class="global-voice-shortcut-caps" dir="ltr">
                <For each={keys()}>{(key) => <Kbd class="global-voice-shortcut-cap">{key}</Kbd>}</For>
              </span>
            </Show>
          </Show>
        </Button>
        <Show
          when={!recording()}
          fallback={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onMouseDown={(event) => event.preventDefault()}
              onClick={stopRecording}
            >
              {t("globalVoice.settings.cancel")}
            </Button>
          }
        >
          <Button type="button" variant="outline" size="sm" disabled={props.disabled} onClick={startRecording}>
            {t("globalVoice.settings.change")}
          </Button>
        </Show>
        <Show when={!recording() && props.defaultAccelerator && props.accelerator !== props.defaultAccelerator}>
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
        <Show when={!recording() && props.clearable && props.accelerator}>
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
      <Show when={!recording() && props.accelerator && isBareTypingKey(props.accelerator)}>
        <p class="global-voice-shortcut-warning" role="status">
          {t("globalVoice.settings.bareKeyWarning")}
        </p>
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
