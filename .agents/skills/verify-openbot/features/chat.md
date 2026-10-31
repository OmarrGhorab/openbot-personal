# Agent chat

## Sub-features
Send a message, see the reply, take a ticket by name or GitHub key, stop a thread.

## How to get to it (user POV)
Click the agent in the sidebar, type in the composer, press Enter.

## Driving it with drive.mjs
`drive.mjs <port> chat "<agent name>"`, then type with `drive.mjs <port> send "<text>"`.

## Gotchas
Agents may only run Gemini 3.8 Flash or OpenCode models. An empty profile has no agents; create one in the app first. Stop all holds every message until a new message lifts it.
