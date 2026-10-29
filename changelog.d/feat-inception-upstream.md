### Changed

- A server now offers Inception, as the computer does. An owner or admin saves the Inception API key
  in the server's provider settings, and the server downloads Pi when it needs it. Phones and team
  members also see Inception agents. Clients older than Team API protocol 8 still do not see them.

### Fixed

- Inception now downloads the Pi CLI when you save its API key. Before, the key was saved but the
  provider showed "The pi CLI is not installed" until you downloaded Pi from its own row in Settings.
- A Pi or Inception agent with Workspace only access on macOS replies again. Before, each message
  stopped with "Credential store read failed" and "EPERM", or Pi stopped at the start.
- A Pi or Inception agent keeps its OpenBot tools after OpenBot restarts. Before, a chat that was
  opened after a restart lost every OpenBot tool, and each restart gave the tools new names, so the
  agent could call old names and get "Tool ... not found". A chat that already shows this error gets
  its tools again at its next turn.
- A Pi or Inception agent whose session file was moved or deleted starts a new session. Before, each
  turn stopped with "The Pi session file is not available on this computer."
- When Inception refuses the saved API key, or its account has no balance, the chat says so. Before,
  it showed the raw error from Inception.
