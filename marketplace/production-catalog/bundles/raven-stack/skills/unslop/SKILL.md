---
name: raven-stack-unslop
description: "Rewrite commit messages, PR titles and bodies, code comments and docs in plain, specific words without AI tells. Use before committing, opening or updating a PR, or posting a review."
---

# Plain writing

Edit text you write for a reviewer. Leave prose you didn't touch alone.

## Process

1. Scan for the patterns below.
2. Rewrite, keeping the meaning.
3. Ask "what makes this obviously machine-written?" and fix what's left.

## Cut

- **Puffery and promo words:** pivotal, testament, landscape, seamless, robust, powerful, groundbreaking. State what happened.
- **AI vocabulary:** additionally, crucial, delve, enhance, foster, leverage, utilize, showcase, underscore. Use plain words: "use", "help", "show".
- **"Serves as", "boasts", "features"** for "is" or "has".
- **"Not just X, but Y"** and forced groups of three. Say the point.
- **Trailing -ing clauses:** "..., ensuring reliability". Delete or make it a real sentence with a fact.
- **Vague attributions:** "experts say". Name the source or cut.
- **Chatbot phrases:** "Great question", "I hope this helps", "Certainly".
- **Filler:** "in order to" is "to", "due to the fact that" is "because", "it is important to note that" goes.
- **Hedging stacks:** "could potentially possibly" is "may".
- **Em dashes** in prose. Use a period or a comma.
- **Bold-label lists** that repeat themselves ("**Performance:** performance improved"). Write the sentence.
- **Title Case Headings** and decorative emoji. Use sentence case.
- **Abstract nouns** for concrete things: substrate, vector, surface, paradigm, north star. Name the real thing.

## Prefer

- What it does, with a number or a mechanism: "`exportCsv()` now writes the header row" beats "export is more reliable".
- Active voice with a named actor: "the job retries three times", not "retries are performed".
- One idea per sentence. Split anything a reader has to reread.
- A sentence that could appear unchanged in another project's PR says nothing about this one. Cut it.

## Raven Stack

This skill is part of Raven Stack. Each Raven Stack skill installs as its own skill: call one with `$raven-stack-<name>`. `$raven-stack-autopilot` runs the whole flow. The license and notice are in `../raven-stack/LICENSE.txt` and `../raven-stack/NOTICE.txt`.
