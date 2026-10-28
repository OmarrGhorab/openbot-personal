### Added

- Agents keep project memory for their folder: commands that work, rules, known problems with their fixes, and decisions. Each new work thread of the agent starts with these facts. Agents save them at the end of a task (`save_lesson`), and record a check that failed for a new reason (`learn_from_failure`). Agents search them with `search_project_memory`. The settings panel of an agent lists each entry with the agent that saved it and the dates. You can edit or delete an entry, and undo the last change to the folder.
- Secrets are redacted before an agent memory or a project memory is saved.
