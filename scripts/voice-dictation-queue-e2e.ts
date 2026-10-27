// Sends two dictations to the real transcription service at the same time, then one of silence.
// Before #72 the second request failed with "busy" and the island stayed on "Write or say a message
// first". Now the second request waits for the host, and both give text. A request of silence
// after them must also complete; the report records its text (Whisper can answer "Thank you.").
//
// The host runs in Electron as Node, as in `voice-transcription-smoke.ts`. The model must be ready in
// `.openbot-build/voice` (open the dev app once, or run the smoke script). Linux and macOS.
//
// Writes `report.json` to `.openbot-build/voice-dictation-queue-e2e/`.
//
//   bun scripts/voice-dictation-queue-e2e.ts <speech.wav> [model id]   (16 kHz mono 16-bit WAV)

import { fork } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isLocalVoiceModelId, type LocalVoiceModelId } from "@openbot/contracts/ipc";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect } from "effect";
import { VoiceApiKeyStore } from "../src/main/voice-api-key-store";
import { openScribeSocket } from "../src/main/voice-cloud-stream";
import {
  BARK_PLUS_MODEL_DIRECTORY,
  FASTCONFORMER_AR_MODEL_DIRECTORY,
  WHISPER_SMALL_MODEL_DIRECTORY,
  WHISPER_TURBO_MODEL_DIRECTORY,
} from "../src/main/voice-model-service";
import { VoicePreferenceStore } from "../src/main/voice-preference-store";
import type {
  VoiceTranscriptionFailure,
  VoiceTranscriptionHostProcess,
  VoiceTranscriptionResponse,
} from "../src/main/voice-transcription-protocol";
import { VoiceTranscriptionService } from "../src/main/voice-transcription-service";

const RESOURCES_ROOT = resolve(".openbot-build/voice");
const OUTPUT = resolve(".openbot-build/voice-dictation-queue-e2e");
const HOST_SOURCE = resolve("src/main/voice-transcription-host.ts");
const HOST = resolve(".openbot-build/voice-transcription-host-queue-e2e.mjs");
const ELECTRON =
  process.platform === "darwin"
    ? resolve("node_modules/electron/dist/Electron.app/Contents/MacOS/Electron")
    : resolve("node_modules/electron/dist/electron");
const MODEL_DIRECTORIES: Record<LocalVoiceModelId, string> = {
  "parakeet-tdt-0.6b-v3": join(RESOURCES_ROOT, "model"),
  "bark-3.0-plus": join(RESOURCES_ROOT, BARK_PLUS_MODEL_DIRECTORY),
  "whisper-turbo": join(RESOURCES_ROOT, WHISPER_TURBO_MODEL_DIRECTORY),
  "fastconformer-ar": join(RESOURCES_ROOT, FASTCONFORMER_AR_MODEL_DIRECTORY),
  "whisper-small": join(RESOURCES_ROOT, WHISPER_SMALL_MODEL_DIRECTORY),
};
const PCM_FROM_JSON = `data:text/javascript,process.prependListener("message",(m)=>{if(m&&typeof m==="object"&&Array.isArray(m.pcm))m.pcm=Uint8Array.from(m.pcm)});`;

const FAILURES: readonly VoiceTranscriptionFailure[] = ["runtime-unavailable", "model-load-failed", "inference-failed"];

const logger = createOpenBotLogger("voice-dictation-queue-e2e");

function spawnHost(): VoiceTranscriptionHostProcess {
  const child = fork(HOST, [], {
    execPath: ELECTRON,
    execArgv: ["--import", PCM_FROM_JSON],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    serialization: "json",
    stdio: "inherit",
  });
  return {
    send: (request) => child.send({ ...request, pcm: Array.from(request.pcm) }),
    onResponse: (listener) => {
      child.on("message", (message: unknown) => listener(responseFromJson(message)));
    },
    onExit: (listener) => {
      child.once("exit", () => listener());
    },
    kill: () => {
      child.kill();
    },
  };
}

function responseFromJson(message: unknown): VoiceTranscriptionResponse {
  if (typeof message !== "object" || message === null || !("id" in message) || typeof message.id !== "number")
    throw new Error("The host sent a message with no id.");
  if ("error" in message) {
    const failure = FAILURES.find((category) => category === message.error);
    if (!failure) throw new Error("The host sent an unknown error.");
    return { id: message.id, error: failure };
  }
  if (!("text" in message) || typeof message.text !== "string") throw new Error("The host sent no text.");
  return { id: message.id, text: message.text };
}

/** Answers the canonical 44-byte WAV that dictation sends, from the data chunk of the file. */
async function canonicalWav(path: string): Promise<Uint8Array> {
  const file = await readFile(path);
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  let offset = 12;
  while (offset + 8 <= file.byteLength) {
    const id = file.toString("ascii", offset, offset + 4);
    const size = view.getUint32(offset + 4, true);
    if (id === "data") return wav(file.subarray(offset + 8, offset + 8 + size));
    offset += 8 + size + (size % 2);
  }
  throw new Error(`${path} has no data chunk.`);
}

function wav(pcm: Uint8Array): Uint8Array {
  const header = new DataView(new ArrayBuffer(44));
  const ascii = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) header.setUint8(offset + index, text.charCodeAt(index));
  };
  ascii(0, "RIFF");
  header.setUint32(4, 36 + pcm.byteLength, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true);
  header.setUint16(22, 1, true);
  header.setUint32(24, 16_000, true);
  header.setUint32(28, 32_000, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  ascii(36, "data");
  header.setUint32(40, pcm.byteLength, true);
  const file = new Uint8Array(44 + pcm.byteLength);
  file.set(new Uint8Array(header.buffer), 0);
  file.set(pcm, 44);
  return file;
}

async function main(): Promise<void> {
  const [speechPath, modelArgument = "whisper-turbo"] = process.argv.slice(2);
  if (!speechPath) throw new Error("Give a 16 kHz mono 16-bit WAV file with speech.");
  if (!isLocalVoiceModelId(modelArgument)) throw new Error(`Not a local dictation model: ${modelArgument}`);
  await mkdir(OUTPUT, { recursive: true });
  const hostBundle = await Bun.build({
    entrypoints: [HOST_SOURCE],
    target: "node",
    format: "esm",
    outdir: resolve(".openbot-build"),
    naming: "voice-transcription-host-queue-e2e.mjs",
  });
  if (!hostBundle.success) throw new Error("Could not bundle the transcription host.");
  const temporary = await mkdtemp(join(tmpdir(), "openbot-dictation-queue-"));
  const voice = new VoiceTranscriptionService({
    resourcesRoot: RESOURCES_ROOT,
    modelDirectories: MODEL_DIRECTORIES,
    preferences: new VoicePreferenceStore(join(temporary, "voice-preference.json")),
    apiKeys: new VoiceApiKeyStore({
      path: join(temporary, "voice-api-key.json"),
      cipher: { canPersist: () => false, encrypt: () => Buffer.alloc(0), decrypt: () => "" },
    }),
    spawnHost,
    openStreamSocket: openScribeSocket,
  });
  try {
    await Effect.runPromise(voice.setSettings({ modelId: modelArgument, language: "automatic" }));
    const status = await Effect.runPromise(voice.downloadModel(modelArgument));
    if (status.phase !== "ready") throw new Error(`${modelArgument} is not ready: ${status.phase}`);
    const speech = await canonicalWav(speechPath);
    const silence = wav(new Uint8Array(16_000 * 2 * 2));
    const startedAt = Date.now();
    const overlapping = await Promise.allSettled([
      Effect.runPromise(voice.transcribe(speech)),
      Effect.runPromise(voice.transcribe(speech)),
    ]);
    const overlapMs = Date.now() - startedAt;
    const silent = await Effect.runPromise(voice.transcribe(silence));
    const texts = overlapping.map((result) => (result.status === "fulfilled" ? result.value.text : null));
    const ok = texts.every((text) => typeof text === "string" && text.trim().length > 0);
    const report = {
      ok,
      at: new Date().toISOString(),
      modelId: modelArgument,
      overlapping: overlapping.map((result) =>
        result.status === "fulfilled" ? { text: result.value.text } : { error: String(result.reason) },
      ),
      overlapMs,
      silenceText: silent.text,
    };
    await writeFile(join(OUTPUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    logger.info(`Report: ${join(OUTPUT, "report.json")}`);
    if (!ok) throw new Error("An overlapping dictation failed.");
  } finally {
    await Effect.runPromise(voice.shutdown());
    await rm(temporary, { recursive: true, force: true });
  }
}

await main();
