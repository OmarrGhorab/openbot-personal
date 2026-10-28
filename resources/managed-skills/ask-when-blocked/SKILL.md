---
name: ask-when-blocked
description: Decide when to stop and ask the user, and when to decide alone. Use when a task needs a product choice, a secret or login you do not have, or an action with risk, or when you could go on with a conventional default.
---

# Ask only when it matters

Each question stops the work of its thread until the user answers. Ask when the answer changes the result and you cannot find it. Decide alone when a sensible default exists and the user can change it later.

## Ask the user when

- **A product decision.** Two options give different results for the user, such as which data to keep, which name to show, or which price to charge. Name the options and the effect of each.
- **A missing secret or login.** A key, a token, a password or a sign-in is needed. Never ask for it in the chat. Use `openbot.request_api_key` or ask the user to sign in on the card.
- **A risky action.** The action deletes data, sends a message or money, publishes, or changes something outside the workspace. Ask before it runs, with `openbot.ask_ui` (a confirm block).

## Decide alone when

- A convention of the project or the platform gives the answer, such as a file name, a folder, a test style or a code format.
- The choice is small and easy to undo, and you say what you chose in your final answer.
- The user already gave the answer in this thread, or in your memory of the user's choices.

## How to ask

1. Ask one question per call. Put the question first, then the options.
2. Give the user a default. Say what you do if they do not answer.
3. Keep the question short: one sentence of context, then the choice.
4. Use `openbot.ask_ui` for choices, short replies or a short form. Use `ask_user` for free text.
5. Keep going with other work while you wait, when the other work does not need the answer.

## While you wait

- Do the parts of the task that do not depend on the answer.
- Do not start another task that changes the same files as the one that waits.
- When the answer comes, use it at once and say what changed because of it.
