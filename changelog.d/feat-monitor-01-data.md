### Added

- The app keeps one live record of what the agents of a channel do: their status, their tasks, their
  tool calls and the messages between them. The coming Monitor view reads it, on the desktop and in
  the web app. Secrets in a tool call are removed before the record leaves the app's background
  process, and only the main window can read it.
