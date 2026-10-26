### Added

- ElevenLabs Scribe dictation now streams while you speak, shows partial words as they arrive, and
  replays the utterance after a dropped connection. The final text replaces the live text, so no
  words are duplicated. If the final text cannot be fetched, the island shows an error instead of
  sending the live text, which may be cut short. Each send takes only the new microphone audio
  instead of decoding the whole recording again.

### Changed

- Local dictation previews refresh every 500 ms, and a tick is skipped while the last preview is still
  running, so Stop never waits behind a line of previews. Whisper stays final-only because each preview would
  take seconds.

### Fixed

- A dropped local speech host no longer loses the dictation: the final pass is retried once and a
  failed transcription shows its error instead of leaving the island waiting.
