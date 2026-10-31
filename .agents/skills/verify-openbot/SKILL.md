---
name: verify-openbot
description: "Launch OpenBot (the Electron desktop app) from a worktree on its own display and profile, drive Tickets, chat and settings over CDP, switch to Arabic RTL and back, and capture real-window screenshots as ticket evidence. Use for before/after proof of a UI change, never against the user's running app."
---

# Verify OpenBot

Proof means the real Electron window, driven the way a person uses it, in English and in Arabic (RTL).
Everything here runs on its own X display, its own `HOME` and its own dev instance, so the user's app and
profile are never touched. Scripts are in `scripts/` next to this file; run them from the repo root of
the checkout you want to prove (your ticket worktree).

## Launch

```bash
SKILL=.agents/skills/verify-openbot/scripts
$SKILL/launch.sh <name> [display] [cdp-port]   # e.g. launch.sh t240 :41 9441
```

- Starts `Xvfb <display>` (1920x1200) when it is not running, makes a scratch `HOME` at
  `/tmp/verify-openbot/<name>/home`, and runs `bun run dev` with `OPENBOT_DEV_INSTANCE_ID=<name>`, so the
  dev stack picks free ports and its own profile (`OpenBot Dev …-<name>`), and with
  `OPENBOT_DEV_REMOTE_DEBUGGING_PORT=<cdp-port>`.
- Ready means usable: it waits until CDP lists the renderer page and `window.openbot` answers. The log is
  `/tmp/verify-openbot/<name>/dev.log`; the pids it started are in `/tmp/verify-openbot/<name>/pids`.
- The first start of an empty profile runs every database migration; give it up to 4 minutes.

## Doctor

```bash
node $SKILL/drive.mjs <cdp-port> doctor
```

Read-only. Prints the page URL, the build's language and direction, and the window size. Run it first
whenever anything looks off. A failure names what is missing (no CDP, no page, no preload bridge).

## Drive

```bash
node $SKILL/drive.mjs <cdp-port> tickets              # open the Tickets board
node $SKILL/drive.mjs <cdp-port> ticket "<title>"     # open one ticket's drawer
node $SKILL/drive.mjs <cdp-port> chat "<agent name>"  # open an agent chat
node $SKILL/drive.mjs <cdp-port> settings             # open Settings
node $SKILL/drive.mjs <cdp-port> lang ar|en           # switch the app language (RTL for ar)
```

Handles are visible names and ARIA labels, not coordinates. Language goes through the same preference the
Settings picker writes (`window.openbot.setAppLanguagePreference`). Never drive the user's instance: the
port you pass is the one you launched.

## Evidence

```bash
$SKILL/shot.sh <display> <file.png>          # one real-window screenshot (ffmpeg x11grab)
$SKILL/record.sh <display> <file.mp4> [secs] # a short recording, default 8 s
```

Then attach it to the ticket with `attach_ticket_evidence` (`phase` before or after, `path` the file).
Capture the action and the resulting state, in English and again after `lang ar`. Save under
`/tmp/verify-openbot/evidence/` (cleanup keeps this folder) or your worktree.

RTL checklist for every Arabic shot:
- the layout mirrors: sidebar on the right, steps and progress read right to left;
- no clipped, overlapping or cut text; Arabic strings are translated, not English;
- numbers, keys (`owner/repo#12`), file paths and English names keep their order inside Arabic text.

## Cleanup

```bash
$SKILL/cleanup.sh <name>
```

Kills only the pids launch recorded (never by process name), stops the Xvfb it started, and removes
`/tmp/verify-openbot/<name>`. Evidence in `/tmp/verify-openbot/evidence/` stays.

## Feature map

See `features/README.md`.
