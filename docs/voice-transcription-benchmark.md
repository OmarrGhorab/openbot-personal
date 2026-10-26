# Voice transcription latency benchmark

Measured on macOS x64 on 2026-10-26 with the real sherpa-onnx runtime and the four English clips in `scripts/voice-transcription-smoke.ts`. The clips use the built-in Samantha voice. Each model received the same WAV samples. The service loaded each local model before timing transcription, as the app now does before it opens the microphone.

These numbers measure the local transcription request after speech ends. They do not include microphone capture, browser audio conversion, IPC, or the renderer update. They are a repeatable model comparison, not end-to-end production latency.

| Model | Warmup | Transcription latency (settings, reply, report, long) | WER per clip |
| --- | ---: | --- | --- |
| Parakeet TDT 0.6B v3 int8 | 3.55 s | 294, 379, 340, 954 ms | 0%, 0%, 11.1%, 0% |
| Whisper large-v3 turbo int8 | 4.17 s | 5,763, 7,274, 9,293, 19,735 ms | 0%, 0%, 0%, 0% |

Parakeet's median request latency was 360 ms; Whisper's was 8,284 ms. Parakeet changed one word in the report clip (`the report` to `a report`), while Whisper matched all four clips. This English-only sample does not measure Arabic accuracy. This build documents that Parakeet does not support Arabic, so Whisper remains the default for the default Arabic setting. Parakeet remains a selectable low-latency model with live previews; Whisper stays final-only because each preview would take several seconds.

The renderer records post-Stop latency in the `voice_transcription` analytics event. Local model
warmup runs before microphone capture: the same Parakeet build took 5.9 s on its first cold pass
before this change, and a warm first pass took 294 ms. Live local previews transcribe the recording
so far every 500 ms; Whisper stays final-only because each preview would take seconds. The smoke
script writes the full per-clip output to `.openbot-build/voice-transcription-smoke/report.json`.
