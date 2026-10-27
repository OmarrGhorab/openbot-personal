// Run: bun scripts/instance-transfer-secrets-e2e.ts
// Report: .openbot-build/instance-transfer-secrets-e2e.json

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentProviderId, McpServerConfig, UpdateCustomProviderInput } from "@openbot/contracts/ipc";
import { Effect } from "effect";
import type { CustomProviderConfig } from "../src/backend/opencode-config";
import type { GitHubConnectorSession } from "../src/main/github-connector-service";
import { createSecretKeyPair, openValue, sealValue } from "../src/main/instance-transfer-secrets";
import {
  type InstanceTransferSecretSources,
  InstanceTransferSecretsService,
} from "../src/main/instance-transfer-secrets-service";

const sentinel = "e2e-secret-must-not-appear-in-transfer-output";
const migrationId = "1".repeat(64);
const provider: AgentProviderId = "codex";
const mcp: McpServerConfig = {
  id: "e2e-mcp",
  name: "Private MCP",
  transport: "stdio",
  enabled: true,
  command: "mcp-server",
  args: [],
  env: [{ key: "API_TOKEN", value: sentinel }],
  envPassthrough: [],
  workingDirectory: "",
  url: "",
  headers: [{ key: "Authorization", value: sentinel }],
};

function sources(
  credentials = new Map<AgentProviderId, string>(),
  onMcpSave = () => {},
  customProviders: CustomProviderConfig[] = [],
  onCustomProviderUpdate: (input: UpdateCustomProviderInput) => Effect.Effect<unknown, unknown> = () => Effect.void,
  githubSession: GitHubConnectorSession | null = null,
  onGithubAdopt: (session: GitHubConnectorSession) => void = () => {},
): InstanceTransferSecretSources {
  let currentGithubSession = githubSession;
  return {
    providers: {
      saved: () => [...credentials.keys()],
      get: (id) => credentials.get(id) ?? null,
      set: (id, key) => Effect.sync(() => credentials.set(id, key)).pipe(Effect.asVoid),
    },
    mcp: {
      list: () => [
        { ...mcp, env: mcp.env.map((pair) => ({ ...pair })), headers: mcp.headers.map((pair) => ({ ...pair })) },
      ],
      save: () => Effect.sync(onMcpSave),
    },
    signedInProviders: () => ["claude"],
    github: {
      session: () => currentGithubSession,
      adoptSession: (session) =>
        Effect.sync(() => {
          currentGithubSession = session;
          onGithubAdopt(session);
        }).pipe(Effect.asVoid),
    },
    onePassword: {
      serviceAccountToken: () => null,
      connectWithToken: () => Effect.void,
      connected: () => false,
    },
    customProviders: () => customProviders,
    updateCustomProvider: (input) => onCustomProviderUpdate(input),
    mcpSignIns: () => [],
    bitwardenConnected: () => false,
  };
}

const run = Effect.runPromise;
const reportPath = fileURLToPath(new URL("../.openbot-build/instance-transfer-secrets-e2e.json", import.meta.url));
const checks: { name: string; status: "passed" | "failed" }[] = [];

try {
  const recipient = createSecretKeyPair();
  const plaintext = Buffer.from(sentinel, "utf8");
  const envelope = sealValue(plaintext, recipient.publicKey, migrationId, "provider-key:codex");
  assert.equal(
    openValue(envelope, recipient.privateKey, migrationId, "provider-key:codex")?.toString("utf8"),
    sentinel,
  );
  assert.equal(JSON.stringify(envelope).includes(sentinel), false);

  const wrongKey = createSecretKeyPair();
  assert.equal(openValue(envelope, wrongKey.privateKey, migrationId, "provider-key:codex"), null);
  const ciphertext = Buffer.from(envelope.ciphertext, "base64");
  const firstCiphertextByte = ciphertext.at(0);
  if (firstCiphertextByte === undefined) throw new Error("The sealed payload has no ciphertext.");
  ciphertext.set([firstCiphertextByte ^ 1], 0);
  assert.equal(
    openValue(
      { ...envelope, ciphertext: ciphertext.toString("base64") },
      recipient.privateKey,
      migrationId,
      "provider-key:codex",
    ),
    null,
  );
  recipient.privateKey.fill(0);
  wrongKey.privateKey.fill(0);
  plaintext.fill(0);
  checks.push({ name: "round-trip-wrong-key-and-tampering", status: "passed" });

  const sourceCredentials = new Map<AgentProviderId, string>([[provider, sentinel]]);
  const targetCredentials = new Map<AgentProviderId, string>();
  const sourceGithubSession: GitHubConnectorSession = {
    accessToken: sentinel,
    accessTokenExpiresAt: Date.now() + 60_000,
    refreshToken: "e2e-refresh-token",
    refreshTokenExpiresAt: Date.now() + 120_000,
    login: "e2e-user",
    userId: 123,
    avatarUrl: "https://example.invalid/avatar.png",
  };
  const sourceCustomProvider: CustomProviderConfig = {
    id: "custom-e2e",
    name: "Private endpoint",
    baseUrl: "https://example.invalid/v1",
    apiKey: sentinel,
    models: [{ id: "model", name: "Model" }],
    headers: [{ name: "Authorization", value: sentinel }],
  };
  const sourceCustomProviders: CustomProviderConfig[] = [sourceCustomProvider];
  const targetCustomProviders: CustomProviderConfig[] = [
    { ...sourceCustomProvider, apiKey: "target-custom-key", headers: [] },
  ];
  let targetMcpSaves = 0;
  let targetCustomUpdates = 0;
  const source = new InstanceTransferSecretsService(
    sources(sourceCredentials, () => {}, sourceCustomProviders, undefined, sourceGithubSession),
  );
  let targetGithubSession: GitHubConnectorSession | null = null;
  const target = new InstanceTransferSecretsService(
    sources(
      targetCredentials,
      () => (targetMcpSaves += 1),
      targetCustomProviders,
      (input) =>
        Effect.sync(() => {
          targetCustomUpdates += 1;
          const index = targetCustomProviders.findIndex((provider) => provider.id === input.id);
          const current = targetCustomProviders[index];
          if (index >= 0 && current) {
            targetCustomProviders[index] = {
              ...current,
              name: input.name,
              baseUrl: input.baseUrl,
              models: input.models,
              apiKey: input.apiKey ?? current.apiKey,
              headers: input.headers ?? current.headers,
            };
          }
        }),
      null,
      (session) => (targetGithubSession = session),
    ),
  );
  const summary = await run(source.list());
  assert.equal(JSON.stringify(summary).includes(sentinel), false);
  const apiKey = summary.items.find((item) => item.kind === "provider-key");
  const oauth = summary.items.find((item) => item.kind === "provider-sign-in");
  const github = summary.items.find((item) => item.kind === "github");
  const mcpValues = summary.items.find((item) => item.kind === "mcp-values");
  const customProvider = summary.items.find((item) => item.kind === "custom-provider");
  assert.ok(apiKey?.transferable);
  assert.ok(customProvider?.transferable);
  assert.ok(github?.transferable);
  assert.equal(oauth?.transferable, false);
  assert.equal(mcpValues?.transferable, false);
  assert.equal(JSON.stringify(mcpValues).includes(sentinel), false);

  const targetKey = await run(target.createKey("e2e-owner", migrationId));
  const sealed = await run(
    source.seal({
      migrationId,
      targetPublicKey: targetKey.publicKey,
      ids: [
        apiKey.id,
        customProvider?.id ?? "custom-provider:custom-e2e",
        github?.id ?? "github",
        oauth?.id ?? "provider-sign-in:claude",
        mcpValues?.id ?? "mcp-values:Private MCP",
      ],
    }),
  );
  assert.equal(sealed.items.length, 3);
  assert.equal(sealed.failed.length, 2);
  assert.equal(JSON.stringify(sealed).includes(sentinel), false);

  const applied = await run(target.apply("e2e-owner", migrationId, sealed.items));
  assert.equal(applied.outcomes.length, 3);
  assert.ok(applied.outcomes.every((outcome) => outcome.status === "transferred"));
  assert.equal(targetCredentials.get(provider), sentinel);
  assert.deepEqual(targetGithubSession, sourceGithubSession);
  assert.equal(targetMcpSaves, 0);
  assert.equal(targetCustomUpdates, 1);
  assert.equal(targetCustomProviders[0]?.apiKey, "target-custom-key");
  assert.equal(targetCustomProviders[0]?.headers[0]?.value, sentinel);
  assert.equal(JSON.stringify(applied).includes(sentinel), false);
  checks.push({ name: "summary-sealing-at-rest-and-mcp-redaction", status: "passed" });

  const report = { status: "passed", checks };
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report)}\n`);
} catch (error) {
  const report = {
    status: "failed",
    checks: [...checks, { name: "instance-transfer-secrets", status: "failed" }],
    error: error instanceof Error ? error.message : String(error),
  };
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stderr.write(`${JSON.stringify(report)}\n`);
  process.exitCode = 1;
}
