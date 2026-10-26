# Voice transcription latency benchmark

Measured on macOS x64 on 2026-10-26 with the real sherpa-onnx runtime and the four English clips in `scripts/voice-transcription-smoke.ts`. The clips use the built-in Samantha voice. Each model received the same WAV samples. The service loaded each local model before timing transcription, as the app now does before it opens the microphone.

These numbers measure the local transcription request after speech ends. They do not include microphone capture, browser audio conversion, IPC, or the renderer update. They are a repeatable model comparison, not end-to-end production latency.

| Model | Warmup | Transcription latency (settings, reply, report, long) | WER per clip |
| --- | ---: | --- | --- |
| Parakeet TDT 0.6B v3 int8 | 3.55 s | 294, 379, 340, 954 ms | 0%, 0%, 11.1%, 0% |
| Whisper large-v3 turbo int8 | 4.17 s | 5,763, 7,274, 9,293, 19,735 ms | 0%, 0%, 0%, 0% |

Parakeet's median request latency was 360 ms; Whisper's was 8,284 ms. Parakeet changed one word in the report clip (`the report` to `a report`), while Whisper matched all four clips. This English-only sample does not measure Arabic accuracy. This build documents that Parakeet does not support Arabic, so Whisper remains the default for the default Arabic setting. Parakeet remains a selectable low-latency model with live previews; Whisper stays final-only because each preview would take several seconds.

The renderer records the same post-Stop span in the `voice_transcription` analytics event for a real
dictation. The smoke script writes the full per-clip output to
`.openbot-build/voice-transcription-smoke/report.json`.

## Where the delay comes from

- **Model load.** The first request in a new process paid 5.9 s for Parakeet before this change. The
  service now loads the model while the user speaks, so the same load costs 3.55 s off the critical
  path; Whisper's load costs 4.17 s.
- **Inference after Stop.** Parakeet reads the four clips in 294–954 ms. Whisper takes 5.8–19.7 s,
  which is why the default stays Whisper only for its Arabic support and Parakeet remains the
  selectable low-latency model for English.
- **Preview queue.** A local preview reads the recording so far every 500 ms. At Stop, the final
  pass waits for a preview already in flight. The window shows the live text until the final text
  replaces it, so no partial text is duplicated.
- **Audio, IPC and paint.** This benchmark excludes microphone capture, browser audio conversion,
  IPC and the renderer update. The `voice_transcription` analytics event measures Stop to final text
  (`duration_ms`) together with the audio length, so a real dictation records the end-to-end cost
  without sending the text.

The smoke test is macOS-only and uses synthetic speech. It does not measure Arabic accuracy, a real
microphone, or Windows; those still need a live run on each platform.

