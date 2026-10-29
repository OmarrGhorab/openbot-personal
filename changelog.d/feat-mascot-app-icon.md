### Added

- App icon mascots. Settings > General > App icon has 10 mascots and 3 tiles (dark, light and a tint of the logo color). The Dock or taskbar icon shows the chosen mascot in the logo color while OpenBot runs. The logos in the app do not change.
- Jira sync. When the Atlassian app is connected in the Marketplace, Sync tickets lists Jira next to GitHub. Choose a Jira project and its open issues come into Backlog. A move to Done takes the Jira Done transition, and the comments of an agent go back to the issue.
- Sync tickets shows the GitHub and Jira icons, lets you pick the system and the repository or project from a list, and filters a long list as you type.
- Raven team opens from the Tickets page. The Raven team button opens the team page, and Run with team in a ticket opens it with that ticket filled in.
- Tickets page: search, the ticket system and key above each title, and a scroll in each column so a long Backlog stays short.
- Raven Stack team page, redesigned. It has two steps, Ticket and Team, with presets for a full feature and a small ticket, one card for each role, and a start bar that names the team. The team is checked as you write the ticket, so each role shows its provider, model and effort without a button. Running jobs show their roles as a row of steps.
- Skip roles for an easy ticket. Switch off the Architect, Reviewer or Quality for one ticket. A skipped Architect hands its planning to the Builder. If no role checks the work, the job ends when the Builder commits, and the page warns you first.

### Changed

- The Dock and taskbar icon of the release app is now the Blob mascot on a dark tile. When OpenBot is closed, macOS still shows the icon in the app bundle.

### Fixed

- Creating a channel no longer freezes the window. Before, the app stayed blank, and a saved channel kept it on the loading screen at every start.
- Opening Marketplace skills or the Sites tab of the server settings no longer freezes the window.
- Choosing the agent in the New ticket dialog works. Before, the menu opened behind the dialog and you could not pick an agent.
- Choosing the ticket system and the repository in Sync tickets works. Before, the menus opened behind the dialog, so you could not pick a repository and Save and sync stayed off.
