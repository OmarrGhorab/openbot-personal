### Added

- During setup copy, you can select supported provider API keys, matching custom-provider keys and headers, GitHub sign-in, and 1Password service-account tokens to transfer. The source encrypts each value to a short-lived target key over the authenticated connection, and the target stores it through its existing encrypted credential store. Existing target credentials take precedence.
- MCP env/header values and sign-ins that cannot safely move are listed in the completion summary with a re-authentication action. Secret values stay out of the transfer archive, preview, logs, and analytics.
