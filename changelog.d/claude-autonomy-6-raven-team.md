### Added

- Start a Raven Stack team from the search bar, on the computer that runs OpenBot. Write the ticket and name a model for a role, for example `Reviewer: model-name`. Each role runs on its own agent and work thread. A role you do not name uses the template model.
- Check before the start: each role with its model and access, and a warning when a verifier uses the Builder's model. An unknown model stops the start, and OpenBot asks you for another model. It never picks one for you.
- Only the Builder changes the branch. The Reviewer and the Quality role check the head commit that the Builder reports. A new commit clears their old verdicts.
- Two FAIL rounds ask you for a stronger Builder model, or use the fallback model that the ticket names. The third FAIL round stops the team as not done.
- Stop and resume the whole team. You can change a role's model during a run.
