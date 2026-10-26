### Added

- ElevenLabs Scribe dictation now streams while you speak, shows partial words as they arrive, and
  replays the utterance after a dropped connection. The final text replaces the live text, so no
  words are duplicated.

### Changed

- Local dictation previews refresh every 500 ms. Whisper stays final-only because each preview would
  take seconds.

### Fixed

- A dropped local speech host no longer loses the dictation: the final pass is retried once and a
  failed transcription shows its error instead of leaving the island waiting.
