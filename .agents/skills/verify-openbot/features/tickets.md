# Tickets

## Sub-features
Board columns (Backlog, Queued, Running, Needs review, Done), ticket drawer (status steps, work phase, review verdict, evidence, activity), Approve and Request changes.

## How to get to it (user POV)
The Tickets icon in the left rail, then click a card.

## Driving it with drive.mjs
`drive.mjs <port> tickets`, then `drive.mjs <port> ticket "<title>"`. Create a ticket first with `window.openbot.boardTickets.create({ title })` only when the journey needs one and say so in the evidence.

## Gotchas
The board reads the list again on a change event; a row written straight to SQLite needs a reload. An empty profile has no tickets.
