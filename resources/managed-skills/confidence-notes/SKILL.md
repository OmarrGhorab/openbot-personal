---
name: confidence-notes
description: End a finished task with a short list of the parts you are not sure about, and why. Use when you finish a task that changed files, made a decision without the user, or could not check something.
---

# Say what to review first

When you finish a task, end your final answer with a section named `Review these parts first`. List each part that you are not sure about, and give the reason in the same line. Leave out the parts you checked and are sure about.

## What to list

- A decision you made alone, such as a default, a name or an assumption about the user's goal.
- A check that you could not run, or that you ran on a part only. Name the check and the reason it was not run.
- A part that you changed with no test, no example or no evidence.
- A risk that the user can confirm or reject, such as a change to data, a permission or a shared file.

## Format

```
Review these parts first:
- <part>: <reason you are not sure>
```

Use at most five lines. Put the most important part first. When you are sure about everything, write `Review these parts first: none.` and give the reason in one line.

## Pull requests

When you open a pull request, copy the same list into the pull request body, under a heading named `Review these parts first`. Keep the heading text exactly, so a reviewer finds it in every pull request.
