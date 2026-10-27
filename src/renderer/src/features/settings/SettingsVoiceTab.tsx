import {
  AUTOMATIC_VOICE_LANGUAGE,
  DEFAULT_GLOBAL_VOICE_PREFERENCE,
  ELEVENLABS_VOICE_MODEL_ID,
  SPEECH_MODEL,
  SPEECH_VOICES,
  type SpeechModelStatus,
  type SpeechVoice,
  VOICE_MODELS,
  type VoiceLanguage,
  type VoiceModelInfo,
  type VoiceModelStatus,
  WHISPER_LANGUAGES,
  type WhisperLanguage,
} from "@openbot/contracts/ipc";
import type { AppTextKey } from "@openbot/i18n";
import {
  Badge,
  Button,
  Download,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Play,
  Progress,
  RefreshCw,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsSection,
  Square,
  SwitchField,
} from "@openbot/ui";
import { GlobalVoiceShortcutField } from "@openbot/ui/features/global-voice/GlobalVoiceShortcutField";
import { useText } from "@openbot/ui/text";
import { createMemo, createSignal, createStore, For, onSettled, Show } from "solid-js";
import type { SettingsVoiceStore } from "./settings-voice-store";

const MODEL_DESCRIPTION = {
  "parakeet-tdt-0.6b-v3": "settings.voice.model.parakeet.description",
  "bark-3.0-plus": "settings.voice.model.bark.description",
  "whisper-turbo": "settings.voice.model.whisper.description",
  "fastconformer-ar": "settings.voice.model.fastconformerArabic.description",
  "whisper-small": "settings.voice.model.whisperSmall.description",
  [ELEVENLABS_VOICE_MODEL_ID]: "settings.voice.model.elevenlabs.description",
} as const satisfies Record<VoiceModelInfo["id"], AppTextKey>;

/** The language that the model uses, and why it cannot be set, for each model that takes no language. */
const FIXED_LANGUAGE: Partial<Record<VoiceModelInfo["id"], { language: VoiceLanguage; description: AppTextKey }>> = {
  "parakeet-tdt-0.6b-v3": { language: AUTOMATIC_VOICE_LANGUAGE, description: "settings.voice.language.modelDetects" },
  "bark-3.0-plus": { language: "en", description: "settings.voice.language.englishOnly" },
  "fastconformer-ar": { language: "ar", description: "settings.voice.language.arabicOnly" },
};

const LANGUAGE_NAME = {
  ar: "language.name.ar",
  en: "language.name.en",
} as const satisfies Record<WhisperLanguage, AppTextKey>;

/** The country of a language's flag: the likely region of the language, as `Intl.Locale` gives it. */
function flagFor(language: VoiceLanguage): string {
  if (language === AUTOMATIC_VOICE_LANGUAGE) return "🌐";
  try {
    const region = new Intl.Locale(language).maximize().region;
    if (region && /^[A-Z]{2}$/u.test(region))
      return String.fromCodePoint(...[...region].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65));
  } catch {
    // A tag the engine does not know shows no flag.
  }
  return "🌐";
}

interface SettingsVoiceTabProps {
  store: SettingsVoiceStore;
  selectMount: HTMLElement | undefined;
}

export function SettingsVoiceTab(props: SettingsVoiceTabProps) {
  const { t, format, errorMessage } = useText();
  const settings = () => props.store.state.settings;
  const activeModel = () => VOICE_MODELS.find((model) => model.id === settings()?.modelId);
  const fixedLanguage = () => {
    const model = activeModel();
    return model && !model.supportsLanguage ? FIXED_LANGUAGE[model.id] : undefined;
  };
  const languageName = (language: VoiceLanguage) =>
    language === AUTOMATIC_VOICE_LANGUAGE ? t("settings.voice.language.automatic") : t(LANGUAGE_NAME[language]);
  const languageOptions = createMemo((): VoiceLanguage[] => {
    const collator = new Intl.Collator(format.locale);
    const names = new Map(WHISPER_LANGUAGES.map((language) => [language, languageName(language)]));
    const sorted = [...WHISPER_LANGUAGES].sort((left, right) =>
      collator.compare(names.get(left) ?? left, names.get(right) ?? right),
    );
    // Arabic and English only: automatic detection can pick a third language.
    return sorted;
  });

  // The key is never read back: main has no getter for it, and the field clears once it is saved.
  const [apiKey, setApiKey] = createStore({ draft: "", saving: false });
  const saveApiKey = async () => {
    const key = apiKey.draft.trim();
    if (!key || apiKey.saving) return;
    setApiKey((draft) => {
      draft.saving = true;
    });
    const saved = await props.store.saveApiKey(key);
    setApiKey((draft) => {
      draft.saving = false;
      if (saved) draft.draft = "";
    });
  };

  const downloadText = (bytes: number, status: VoiceModelStatus | SpeechModelStatus | null) => {
    if (status?.phase === "downloading")
      return t("settings.voice.model.downloading", {
        received: format.fileSize(Math.round((bytes * (status.progress ?? 0)) / 100)),
        total: format.fileSize(bytes),
      });
    if (status?.phase === "error") return errorMessage(status.message, t("settings.voice.model.failed"));
    return t("settings.voice.model.size", { size: format.fileSize(bytes) });
  };
  const statusText = (model: VoiceModelInfo, status: VoiceModelStatus | null) => {
    if (model.kind === "cloud")
      return status?.phase === "ready" ? t("settings.voice.model.keySaved") : t("settings.voice.model.keyMissing");
    return downloadText(model.bytes, status);
  };

  const globalVoice = () => props.store.state.globalVoice;
  const [voiceAgents, setVoiceAgents] = createSignal<Array<{ id: string; name: string }>>([]);
  onSettled(() => {
    void window.openbot.agent
      .listAgents()
      .then((agents) => {
        setVoiceAgents(agents.filter((agent) => !agent.hiddenAt).map((agent) => ({ id: agent.id, name: agent.name })));
      })
      .catch(() => undefined);
  });
  const shortcutStatus = (kind: "dictation" | "picker") =>
    globalVoice()?.shortcuts.find((shortcut) => shortcut.target.type === kind)?.status;

  const speech = () => props.store.state.speech;
  const speechPhase = () => speech().status?.phase;
  const voiceName = (voice: SpeechVoice) =>
    t(voice.startsWith("F") ? "settings.voice.speech.voice.female" : "settings.voice.speech.voice.male", {
      number: voice.slice(1),
    });

  const LanguageLabel = (labelProps: { language: VoiceLanguage | undefined }) => (
    <Show when={labelProps.language}>
      {(language) => (
        <>
          <span aria-hidden="true">{flagFor(language())}</span> {languageName(language())}
        </>
      )}
    </Show>
  );

  return (
    <>
      <SettingsSection data-settings-row="settings.voice.models.title" title={t("settings.voice.models.title")}>
        <ItemGroup class="settings-modal-card">
          <For each={VOICE_MODELS}>
            {(model) => {
              const status = () => props.store.state.statuses[model.id];
              const phase = () => status()?.phase;
              const inUse = () => settings()?.modelId === model.id;
              return (
                <Item class="settings-modal-row">
                  <ItemContent>
                    <ItemTitle>{model.name}</ItemTitle>
                    <ItemDescription>{t(MODEL_DESCRIPTION[model.id])}</ItemDescription>
                    <ItemDescription aria-live="polite">{statusText(model, status())}</ItemDescription>
                    <Show when={phase() === "downloading"}>
                      <Progress
                        value={status()?.progress ?? 0}
                        aria-label={t("settings.voice.model.progressLabel", { name: model.name })}
                      />
                    </Show>
                    <Show when={model.kind === "cloud" && phase() === "missing"}>
                      <div class="settings-voice-key">
                        <Input
                          type="password"
                          size="sm"
                          autocomplete="off"
                          spellcheck={false}
                          aria-label={t("settings.voice.apiKey.label")}
                          placeholder={t("settings.voice.apiKey.placeholder")}
                          value={apiKey.draft}
                          disabled={apiKey.saving}
                          onValueChange={(value) =>
                            setApiKey((draft) => {
                              draft.draft = value;
                            })
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter") void saveApiKey();
                          }}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          type="button"
                          disabled={!apiKey.draft.trim() || apiKey.saving}
                          onClick={() => void saveApiKey()}
                        >
                          {t("settings.voice.apiKey.save")}
                        </Button>
                      </div>
                    </Show>
                  </ItemContent>
                  <ItemActions>
                    {/* The selected model is in use before its download too: dictation downloads it. */}
                    <Show when={inUse()}>
                      <Badge variant="secondary">{t("settings.voice.model.inUse")}</Badge>
                    </Show>
                    <Show when={model.kind === "cloud" && phase() === "ready"}>
                      <Button variant="ghost" size="sm" type="button" onClick={() => void props.store.removeApiKey()}>
                        {t("settings.voice.apiKey.remove")}
                      </Button>
                    </Show>
                    <Show when={model.kind === "local" && phase() === "missing"}>
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        aria-label={t("settings.voice.model.downloadLabel", { name: model.name })}
                        onClick={() => props.store.download(model.id)}
                      >
                        <Download size={14} aria-hidden="true" />
                        {t("common.download")}
                      </Button>
                    </Show>
                    <Show when={phase() === "downloading"}>
                      <Button
                        variant="ghost"
                        size="sm"
                        type="button"
                        aria-label={t("settings.voice.model.cancelLabel", { name: model.name })}
                        onClick={() => props.store.cancel(model.id)}
                      >
                        {t("common.cancel")}
                      </Button>
                    </Show>
                    <Show when={phase() === "error"}>
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        aria-label={t("settings.voice.model.retryLabel", { name: model.name })}
                        onClick={() => props.store.download(model.id)}
                      >
                        <RefreshCw size={14} aria-hidden="true" />
                        {t("common.tryAgain")}
                      </Button>
                    </Show>
                    <Show when={phase() === "ready" && settings() && !inUse()}>
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        aria-label={t("settings.voice.model.useLabel", { name: model.name })}
                        onClick={() => props.store.useModel(model.id)}
                      >
                        {t("settings.voice.model.use")}
                      </Button>
                    </Show>
                    <Show when={model.kind === "local" && phase() === "ready"}>
                      <Button
                        variant="ghost"
                        size="sm"
                        type="button"
                        aria-label={t("settings.voice.model.removeLabel", { name: model.name })}
                        onClick={() => props.store.remove(model.id)}
                      >
                        {t("common.remove")}
                      </Button>
                    </Show>
                  </ItemActions>
                </Item>
              );
            }}
          </For>
        </ItemGroup>
      </SettingsSection>

      <SettingsSection title={t("settings.voice.language.section")}>
        <ItemGroup class="settings-modal-card">
          <Item data-settings-row="settings.voice.language.title" class="settings-modal-row">
            <ItemContent>
              <ItemTitle>{t("settings.voice.language.title")}</ItemTitle>
              <ItemDescription>
                {t(fixedLanguage()?.description ?? "settings.voice.language.description")}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Select<VoiceLanguage>
                class="settings-modal-select"
                options={languageOptions()}
                value={fixedLanguage()?.language ?? settings()?.language ?? null}
                onChange={(next) => next && props.store.setLanguage(next)}
                disabled={!settings() || activeModel()?.supportsLanguage === false}
                placement="bottom-end"
                itemComponent={(selectProps) => (
                  <SelectItem item={selectProps.item}>
                    <LanguageLabel language={selectProps.item.rawValue} />
                  </SelectItem>
                )}
              >
                <SelectTrigger size="sm" aria-label={t("settings.voice.language.title")}>
                  <SelectValue<VoiceLanguage>>
                    {(state) => <LanguageLabel language={state.selectedOption()} />}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent mount={props.selectMount} />
              </Select>
            </ItemActions>
          </Item>
        </ItemGroup>
      </SettingsSection>

      <SettingsSection title={t("settings.voice.speech.section")}>
        <ItemGroup class="settings-modal-card">
          <Item class="settings-modal-row">
            <ItemContent>
              <ItemTitle>{SPEECH_MODEL.name}</ItemTitle>
              <ItemDescription>{t("settings.voice.speech.model.description")}</ItemDescription>
              <ItemDescription aria-live="polite">{downloadText(SPEECH_MODEL.bytes, speech().status)}</ItemDescription>
              <Show when={speechPhase() === "downloading"}>
                <Progress
                  value={speech().status?.progress ?? 0}
                  aria-label={t("settings.voice.model.progressLabel", { name: SPEECH_MODEL.name })}
                />
              </Show>
            </ItemContent>
            <ItemActions>
              <Show when={speechPhase() === "missing"}>
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  aria-label={t("settings.voice.model.downloadLabel", { name: SPEECH_MODEL.name })}
                  onClick={() => props.store.downloadSpeech()}
                >
                  <Download size={14} aria-hidden="true" />
                  {t("common.download")}
                </Button>
              </Show>
              <Show when={speechPhase() === "downloading"}>
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  aria-label={t("settings.voice.model.cancelLabel", { name: SPEECH_MODEL.name })}
                  onClick={() => props.store.cancelSpeech()}
                >
                  {t("common.cancel")}
                </Button>
              </Show>
              <Show when={speechPhase() === "error"}>
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  aria-label={t("settings.voice.model.retryLabel", { name: SPEECH_MODEL.name })}
                  onClick={() => props.store.downloadSpeech()}
                >
                  <RefreshCw size={14} aria-hidden="true" />
                  {t("common.tryAgain")}
                </Button>
              </Show>
              <Show when={speechPhase() === "ready"}>
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  aria-label={t("settings.voice.model.removeLabel", { name: SPEECH_MODEL.name })}
                  onClick={() => props.store.removeSpeech()}
                >
                  {t("common.remove")}
                </Button>
              </Show>
            </ItemActions>
          </Item>
          <SwitchField
            data-settings-row="settings.voice.speech.readReplies.title"
            checked={speech().settings?.readReplies ?? false}
            disabled={!speech().settings}
            onChange={(checked) => props.store.setReadReplies(checked)}
            label={t("settings.voice.speech.readReplies.title")}
            description={t("settings.voice.speech.readReplies.description")}
          />
          <Item data-settings-row="settings.voice.speech.voice.title" class="settings-modal-row">
            <ItemContent>
              <ItemTitle>{t("settings.voice.speech.voice.title")}</ItemTitle>
            </ItemContent>
            <ItemActions>
              <Button
                variant="ghost"
                size="sm"
                type="button"
                disabled={speechPhase() !== "ready"}
                onClick={() => void props.store.listen(t("settings.voice.speech.sample"))}
              >
                <Show when={speech().listening} fallback={<Play size={14} aria-hidden="true" />}>
                  <Square size={14} aria-hidden="true" />
                </Show>
                {speech().listening ? t("settings.voice.speech.voice.stop") : t("settings.voice.speech.voice.listen")}
              </Button>
              <Select<SpeechVoice>
                class="settings-modal-select"
                options={[...SPEECH_VOICES]}
                value={speech().settings?.voice ?? null}
                onChange={(next) => next && props.store.setSpeechVoice(next)}
                disabled={!speech().settings}
                placement="bottom-end"
                itemComponent={(selectProps) => (
                  <SelectItem item={selectProps.item}>{voiceName(selectProps.item.rawValue)}</SelectItem>
                )}
              >
                <SelectTrigger size="sm" aria-label={t("settings.voice.speech.voice.title")}>
                  <SelectValue<SpeechVoice>>
                    {(state) => {
                      const voice = state.selectedOption();
                      return voice && voiceName(voice);
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent mount={props.selectMount} />
              </Select>
            </ItemActions>
          </Item>
        </ItemGroup>
      </SettingsSection>
      <SettingsSection data-settings-row="globalVoice.settings.title" title={t("globalVoice.settings.title")}>
        <ItemGroup class="settings-modal-card">
          <SwitchField
            data-settings-row="globalVoice.settings.enabled.title"
            checked={globalVoice()?.preference.enabled ?? false}
            disabled={!globalVoice()}
            onChange={(checked) => props.store.setGlobalVoiceEnabled(checked)}
            label={t("globalVoice.settings.enabled.title")}
            description={t("globalVoice.settings.enabled.description")}
          />
          <Item class="settings-modal-row">
            <ItemContent>
              <ItemTitle>{t("globalVoice.settings.dictation.title")}</ItemTitle>
              <ItemDescription>{t("globalVoice.settings.dictation.description")}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <GlobalVoiceShortcutField
                name={t("globalVoice.settings.dictation.title")}
                accelerator={globalVoice()?.preference.accelerator ?? null}
                status={shortcutStatus("dictation")}
                defaultAccelerator={DEFAULT_GLOBAL_VOICE_PREFERENCE.accelerator}
                disabled={!globalVoice()?.preference.enabled}
                onCaptureChange={(capturing) => props.store.setGlobalVoiceCapturing(capturing)}
                onChange={(accelerator) => {
                  if (accelerator) props.store.setGlobalVoiceAccelerator(accelerator);
                }}
              />
            </ItemActions>
          </Item>
          <Item class="settings-modal-row">
            <ItemContent>
              <ItemTitle>{t("globalVoice.settings.picker.title")}</ItemTitle>
              <ItemDescription>{t("globalVoice.settings.picker.description")}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <GlobalVoiceShortcutField
                name={t("globalVoice.settings.picker.title")}
                accelerator={globalVoice()?.preference.pickerAccelerator ?? null}
                status={shortcutStatus("picker")}
                defaultAccelerator={DEFAULT_GLOBAL_VOICE_PREFERENCE.pickerAccelerator}
                disabled={!globalVoice()?.preference.enabled}
                onCaptureChange={(capturing) => props.store.setGlobalVoiceCapturing(capturing)}
                onChange={(accelerator) => {
                  if (accelerator) props.store.setGlobalVoicePickerAccelerator(accelerator);
                }}
              />
            </ItemActions>
          </Item>
          <Item class="settings-modal-row">
            <ItemContent>
              <ItemTitle>{t("globalVoice.settings.mode.title")}</ItemTitle>
              <ItemDescription>{t("globalVoice.settings.mode.description")}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Select<"hold" | "toggle">
                class="settings-modal-select"
                options={["hold", "toggle"]}
                value={globalVoice()?.preference.captureMode ?? "hold"}
                onChange={(next) => next && props.store.setGlobalVoiceCaptureMode(next)}
                disabled={!globalVoice()?.preference.enabled}
                placement="bottom-end"
                itemComponent={(selectProps) => (
                  <SelectItem item={selectProps.item}>
                    {selectProps.item.rawValue === "hold"
                      ? t("globalVoice.settings.mode.hold")
                      : t("globalVoice.settings.mode.toggle")}
                  </SelectItem>
                )}
              >
                <SelectTrigger size="sm" aria-label={t("globalVoice.settings.mode.title")}>
                  <SelectValue<"hold" | "toggle">>
                    {(state) =>
                      state.selectedOption() === "toggle"
                        ? t("globalVoice.settings.mode.toggle")
                        : t("globalVoice.settings.mode.hold")
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent mount={props.selectMount} />
              </Select>
            </ItemActions>
          </Item>
          <Item class="settings-modal-row">
            <ItemContent>
              <ItemTitle>{t("globalVoice.settings.defaultAgent.title")}</ItemTitle>
              <ItemDescription>{t("globalVoice.settings.defaultAgent.description")}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Select<string>
                class="settings-modal-select"
                options={["", ...voiceAgents().map((agent) => agent.id)]}
                value={globalVoice()?.preference.defaultAgentId ?? ""}
                onChange={(next) => props.store.setGlobalVoiceDefaultAgent(next ? next : null)}
                disabled={!globalVoice()?.preference.enabled}
                placement="bottom-end"
                itemComponent={(selectProps) => (
                  <SelectItem item={selectProps.item}>
                    {selectProps.item.rawValue
                      ? (voiceAgents().find((agent) => agent.id === selectProps.item.rawValue)?.name ??
                        selectProps.item.rawValue)
                      : t("globalVoice.settings.defaultAgent.lastUsed")}
                  </SelectItem>
                )}
              >
                <SelectTrigger size="sm" aria-label={t("globalVoice.settings.defaultAgent.title")}>
                  <SelectValue<string>>
                    {(state) => {
                      const id = state.selectedOption();
                      if (!id) return t("globalVoice.settings.defaultAgent.lastUsed");
                      return voiceAgents().find((agent) => agent.id === id)?.name ?? id;
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent mount={props.selectMount} />
              </Select>
            </ItemActions>
          </Item>
          <Show when={globalVoice()?.keyRelease === "needs-accessibility"}>
            <Item class="settings-modal-row">
              <ItemContent>
                <ItemTitle>{t("globalVoice.settings.accessibility.title")}</ItemTitle>
                <ItemDescription>{t("globalVoice.settings.accessibility.description")}</ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button type="button" size="sm" onClick={() => props.store.allowGlobalVoiceAccessibility()}>
                  {t("globalVoice.settings.accessibility.allow")}
                </Button>
              </ItemActions>
            </Item>
          </Show>
          <Show when={globalVoice()?.keyRelease === "unavailable"}>
            <Item class="settings-modal-row">
              <ItemContent>
                <ItemDescription>{t("globalVoice.settings.keyReleaseUnavailable")}</ItemDescription>
              </ItemContent>
            </Item>
          </Show>
          <Show when={globalVoice()?.microphone === "denied"}>
            <Item class="settings-modal-row">
              <ItemContent>
                <ItemTitle>{t("globalVoice.settings.microphone.title")}</ItemTitle>
                <ItemDescription>{t("globalVoice.settings.microphone.description")}</ItemDescription>
              </ItemContent>
              <ItemActions>
                <Button type="button" size="sm" onClick={() => props.store.allowGlobalVoiceMicrophone()}>
                  {t("globalVoice.settings.microphone.allow")}
                </Button>
              </ItemActions>
            </Item>
          </Show>
          <SwitchField
            data-settings-row="globalVoice.settings.sendAfterSpeaking.title"
            checked={globalVoice()?.preference.sendAfterSpeaking ?? true}
            disabled={!globalVoice()}
            onChange={(checked) => props.store.setGlobalVoiceSendAfterSpeaking(checked)}
            label={t("globalVoice.settings.sendAfterSpeaking.title")}
            description={t("globalVoice.settings.sendAfterSpeaking.description")}
          />
        </ItemGroup>
      </SettingsSection>
    </>
  );
}
