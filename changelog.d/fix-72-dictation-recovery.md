### Fixed

- Voice dictation no longer stops on "Write or say a message first". The island sends the transcript
  that it just received, and an empty transcript shows a short error that hides itself. The next
  dictation and the bot picker work again after it.
- A dictation that starts while another one is still transcribing waits for its turn. It no longer
  fails as busy.
- Holding the dictation shortcut no longer stops the dictation at once when the system repeats the key.
- In-app dictation works while an update notice shows.
- The island and the composer always reset after a send, a cancel, or an error.
