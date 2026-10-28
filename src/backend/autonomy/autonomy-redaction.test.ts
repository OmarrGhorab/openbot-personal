// @vitest-environment node
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCauseEffect } from "../effect-boundary";
import { OpenBotDatabase } from "../openbot-database";
import { AUDIT_TEXT_LIMIT, redactAuditText } from "./audit-redaction";
import { AutonomyAuditStore } from "./autonomy-audit-store";

// Failure modes: a secret in a command reaches the audit log in any of the forms agents use (an
// environment assignment, a bearer header, a URL query, a space-separated flag, a basic-auth URL); a
// long or multi-line command makes an unbounded row; the database file keeps a secret after the write.
const SECRET = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
const KEY = "sk-proj-abcdefghijklmnopqrstu";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("audit log redaction", () => {
  it("masks each form of a secret and keeps the command words", () => {
    const masked = [
      redactAuditText(`GH_TOKEN=${SECRET} gh pr create --title "Fix"`),
      redactAuditText(`curl -H 'Authorization: Bearer ${KEY}' https://api.example.com/v1`),
      redactAuditText(`curl 'https://api.example.com/x?api_key=supersecret123&q=1'`),
      redactAuditText(`bun run deploy --token ${SECRET}`),
      redactAuditText(`git push https://x-access-token:${SECRET}@github.com/owner/repo.git`),
      redactAuditText(`npm run build --password=hunter2`),
    ];
    for (const text of masked) {
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain(KEY);
      expect(text).not.toContain("supersecret123");
      expect(text).not.toContain("hunter2");
    }
    expect(masked[0]).toContain("gh pr create");
    expect(masked[3]).toContain("bun run deploy");
  });

  it("keeps a plain command as it is", () => {
    expect(redactAuditText("bun test src/backend/foo.test.ts")).toBe("bun test src/backend/foo.test.ts");
  });

  it("keeps one line and at most the row limit", () => {
    const long = `echo ${"x".repeat(AUDIT_TEXT_LIMIT * 2)}`;
    const bounded = redactAuditText(long);
    expect(bounded.length).toBeLessThanOrEqual(AUDIT_TEXT_LIMIT);
    expect(bounded.endsWith("…")).toBe(true);
    expect(redactAuditText("git status\n\nrm -rf x\n")).not.toContain("\n");
  });

  it("writes only redacted text to the database file", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-audit-redaction-"));
    roots.push(root);
    const database = new OpenBotDatabase(root);
    await runCauseEffect(database.initialize());
    const audit = new AutonomyAuditStore(database);
    audit.record({
      action: "approval.auto",
      agentId: "agent-a",
      risk: "low",
      result: "approved",
      target: `GH_TOKEN=${SECRET} git push origin openbot/x`,
      detail: `rule:git.push.own --api-key ${KEY}`,
    });
    const page = audit.list({});
    expect(page.entries).toHaveLength(1);
    expect(page.entries[0]?.target).not.toContain(SECRET);
    expect(page.entries[0]?.detail).not.toContain(KEY);
    database.close();

    const files = await readdir(root);
    for (const file of files) {
      const contents = await readFile(join(root, file));
      expect(contents.includes(SECRET), file).toBe(false);
      expect(contents.includes(KEY), file).toBe(false);
    }
  });
});
