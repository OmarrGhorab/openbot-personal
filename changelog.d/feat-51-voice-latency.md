### Changed

- Voice dictation loads the local model while you speak, so the first transcription no longer waits
  for the model to load. Parakeet's first pass dropped from 5.9 s to 294 ms in the benchmark.
- Parakeet stays the fast English model and Whisper stays the default, because Parakeet does not
  support Arabic. The measured comparison is in `docs/voice-transcription-benchmark.md`.
- The `voice_transcription` analytics event records the audio length and the time from Stop to text,
  so latency is measured on real recordings.
