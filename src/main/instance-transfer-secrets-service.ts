// The secrets of one instance transfer: what the source holds, sealed to a target key, and the
// rules for writing each kind on the target. No value of any secret is logged, put in a file, or
// sent to the renderer. `instance-transfer-secrets.ts` holds the envelope; this file holds the
// inventory and the merge rules.
//
// Provider keys, matching custom endpoints, the GitHub sign-in and the 1Password token are written
// only when the target has no value. MCP variables and headers are listed for re-authentication
// because this build stores them as plaintext JSON. Other sign-ins default to re-authentication.

import { createHash } from "node:crypto";
import {
  AGENT_PROVIDERS,
  type AgentProviderId,
  agentProviderDescriptor,
  type CustomProviderHeader,
  INSTANCE_TRANSFER_SECRET_LIMITS,
  type InstanceTransferSealedItem,
  type InstanceTransferSecretOutcome,
  type InstanceTransferSecretSection,
  type InstanceTransferSecretSummary,
  type InstanceTransferSecretsResult,
  type InstanceTransferSecretsSummary,
  isAgentProvider,
  type McpServerConfig,
  type SealInstanceTransferSecretsResult,
  type UpdateCustomProviderInput,
} from "@openbot/contracts/ipc";
import { type SourceMessages, sourceText } from "@openbot/i18n/source";
import { registerSecretValue } from "@openbot/logging";
import { Effect, Result } from "effect";
import type { CustomProviderConfig } from "../backend/opencode-config";
import { type ArchiveOperationError, archiveFailure, archiveSync } from "./archive-effects";
import type { GitHubConnectorSession } from "./github-connector-service";
import {
  createSecretKeyPair,
  InstanceTransferSecretKeyring,
  isSecretPublicKey,
  openValue,
  sealValue,
} from "./instance-transfer-secrets";

/** How the source reads and the target writes each kind, wired to the services that own them. */
export interface InstanceTransferSecretSources {
  providers: {
    saved(): AgentProviderId[];
    get(provider: AgentProviderId): string | null;
    set(provider: AgentProviderId, key: string): Effect.Effect<void, unknown>;
  };
  mcp: {
    list(): McpServerConfig[];
    save(config: McpServerConfig): Effect.Effect<unknown, unknown>;
  };
  signedInProviders(): AgentProviderId[];
  github: {
    session(): GitHubConnectorSession | null;
    adoptSession(session: GitHubConnectorSession): Effect.Effect<void, unknown>;
  };
  onePassword: {
    serviceAccountToken(): string | null;
    connectWithToken(token: string): Effect.Effect<unknown, unknown>;
    connected(): boolean;
  };
  customProviders(): readonly CustomProviderConfig[];
  updateCustomProvider(input: UpdateCustomProviderInput): Effect.Effect<unknown, unknown>;
  /** The MCP servers this computer signed in to with OAuth, by resource. */
  mcpSignIns(): string[];
  bitwardenConnected(): boolean;
}

interface SealedInput {
  migrationId: string;
  targetPublicKey: string;
  ids: string[];
}

interface ProviderKeyPayload {
  version: 1;
  kind: "provider-key";
  provider: AgentProviderId;
  apiKey: string;
}

interface GitHubPayload {
  version: 1;
  kind: "github";
  session: GitHubConnectorSession;
}

interface OnePasswordPayload {
  version: 1;
  kind: "onepassword";
  token: string;
}

interface CustomProviderPayload {
  version: 1;
  kind: "custom-provider";
  id: string;
  origin: string;
  apiKey: string | null;
  headers: CustomProviderHeader[];
}

type SecretPayload = ProviderKeyPayload | CustomProviderPayload | GitHubPayload | OnePasswordPayload;

interface InventoryEntry {
  summary: InstanceTransferSecretSummary;
  /** Null for a sign-in the target has to make; those are never sealed. */
  payload: SecretPayload | null;
}

const SECTION_ORDER: Record<InstanceTransferSecretSection, number> = { providers: 0, mcp: 1, connectors: 2 };
const MAX_VALUE = 8192;

function itemId(prefix: string, value: string): string {
  const plain = `${prefix}:${value}`;
  if (plain.length <= 128) return plain;
  return `${prefix}:${createHash("sha256").update(value).digest("hex").slice(0, 32)}`;
}

function sorted(items: InstanceTransferSecretSummary[]): InstanceTransferSecretSummary[] {
  return items.sort(
    (left, right) =>
      SECTION_ORDER[left.section] - SECTION_ORDER[right.section] ||
      left.label.localeCompare(right.label, "en", { sensitivity: "base" }) ||
      left.id.localeCompare(right.id),
  );
}

/** A text field of a decrypted payload, or null when it is not the shape this build wrote. */
function text(value: unknown, maximum = MAX_VALUE): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= maximum ? value : null;
}

function optionalText(value: unknown, maximum = MAX_VALUE): string | null | undefined {
  if (value === null) return null;
  const result = text(value, maximum);
  return result === null ? undefined : result;
}

interface UntrustedSecretPayload {
  version?: unknown;
  kind?: unknown;
  provider?: unknown;
  apiKey?: unknown;
  id?: unknown;
  origin?: unknown;
  headers?: unknown;
  session?: unknown;
  token?: unknown;
}

function secretPayload(value: unknown): UntrustedSecretPayload | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return {
    version: "version" in value ? value.version : undefined,
    kind: "kind" in value ? value.kind : undefined,
    provider: "provider" in value ? value.provider : undefined,
    apiKey: "apiKey" in value ? value.apiKey : undefined,
    id: "id" in value ? value.id : undefined,
    origin: "origin" in value ? value.origin : undefined,
    headers: "headers" in value ? value.headers : undefined,
    session: "session" in value ? value.session : undefined,
    token: "token" in value ? value.token : undefined,
  };
}

function customHeaders(value: unknown): CustomProviderHeader[] | null {
  if (!Array.isArray(value) || value.length > 256) return null;
  const headers: CustomProviderHeader[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return null;
    const name = text("name" in entry ? entry.name : undefined, 256);
    const value0 = text("value" in entry ? entry.value : undefined);
    if (name === null || value0 === null) return null;
    headers.push({ name, value: value0 });
  }
  return headers;
}

function providerOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

function numberOrNull(value: unknown): number | null | undefined {
  return value === null ? null : typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function githubSession(value: unknown): GitHubConnectorSession | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const accessToken = text("accessToken" in value ? value.accessToken : undefined);
  const accessTokenExpiresAt = numberOrNull("accessTokenExpiresAt" in value ? value.accessTokenExpiresAt : undefined);
  const refreshToken = optionalText("refreshToken" in value ? value.refreshToken : undefined);
  const refreshTokenExpiresAt = numberOrNull(
    "refreshTokenExpiresAt" in value ? value.refreshTokenExpiresAt : undefined,
  );
  const login = text("login" in value ? value.login : undefined, 256);
  const userId =
    "userId" in value && typeof value.userId === "number" && Number.isSafeInteger(value.userId) && value.userId >= 0
      ? value.userId
      : null;
  const avatarUrl = optionalText("avatarUrl" in value ? value.avatarUrl : undefined, 2048);
  if (
    accessToken === null ||
    accessTokenExpiresAt === undefined ||
    refreshToken === undefined ||
    refreshTokenExpiresAt === undefined ||
    login === null ||
    userId === null ||
    avatarUrl === undefined
  )
    return null;
  // A refresh token without its expiry, or the reverse, is not a pair this app wrote.
  if ((refreshToken === null) !== (refreshTokenExpiresAt === null)) return null;
  return { accessToken, accessTokenExpiresAt, refreshToken, refreshTokenExpiresAt, login, userId, avatarUrl };
}

/**
 * One transfer's secret inventory and target writes. `list` and `seal` read the source; `createKey`
 * and `apply` serve the target. The keyring is the only state and it holds no value from the source.
 */
export class InstanceTransferSecretsService {
  readonly #keys: InstanceTransferSecretKeyring;

  constructor(
    private readonly sources: InstanceTransferSecretSources,
    now: () => number = Date.now,
  ) {
    this.#keys = new InstanceTransferSecretKeyring(now);
  }

  /** Every secret of this computer, without a value. */
  list(): Effect.Effect<InstanceTransferSecretsSummary, ArchiveOperationError> {
    return archiveSync(() => ({ items: sorted(this.#inventory().map((entry) => entry.summary)) }));
  }

  /** A fresh key for one migration. The caller has already checked that the target recorded it. */
  createKey(owner: string, migrationId: string): Effect.Effect<{ publicKey: string }, ArchiveOperationError> {
    return archiveSync(() => {
      const pair = createSecretKeyPair();
      this.#keys.add(owner, migrationId, pair.privateKey);
      return { publicKey: pair.publicKey };
    });
  }

  /** Seal the selected secrets to the target's key. An item that cannot be sealed stays here. */
  seal(input: SealedInput): Effect.Effect<SealInstanceTransferSecretsResult, ArchiveOperationError> {
    return archiveSync(() => {
      if (!isSecretPublicKey(input.targetPublicKey))
        throw new Error(sourceText("error.import.transferSecretKeyInvalid"));
      const inventory = new Map(this.#inventory().map((entry) => [entry.summary.id, entry]));
      const items: InstanceTransferSealedItem[] = [];
      const failed: { id: string; reason: string }[] = [];
      let total = 0;
      for (const id of [...new Set(input.ids)]) {
        const entry = inventory.get(id);
        if (!entry?.payload) {
          failed.push({
            id,
            reason: sourceText(entry ? "error.import.transferSecretUnsupported" : "error.import.transferSecretGone"),
          });
          continue;
        }
        const payload = Buffer.from(JSON.stringify(entry.payload), "utf8");
        if (
          payload.length > INSTANCE_TRANSFER_SECRET_LIMITS.itemBytes ||
          total + payload.length > INSTANCE_TRANSFER_SECRET_LIMITS.totalBytes
        ) {
          payload.fill(0);
          failed.push({ id, reason: sourceText("error.import.transferSecretTooLarge") });
          continue;
        }
        try {
          const sealed = sealValue(payload, input.targetPublicKey, input.migrationId, id);
          items.push({
            id,
            kind: entry.summary.kind,
            label: entry.summary.label,
            publicKey: sealed.publicKey,
            salt: sealed.salt,
            nonce: sealed.nonce,
            ciphertext: sealed.ciphertext,
          });
          total += payload.length;
        } catch {
          failed.push({ id, reason: sourceText("error.import.transferSecretSeal") });
        } finally {
          payload.fill(0);
        }
      }
      return { items, failed };
    });
  }

  /** Open and write every item. One bad item fails alone; the others continue. */
  apply(
    owner: string,
    migrationId: string,
    items: readonly InstanceTransferSealedItem[],
  ): Effect.Effect<InstanceTransferSecretsResult, ArchiveOperationError> {
    return Effect.gen({ self: this }, function* () {
      if (items.length > INSTANCE_TRANSFER_SECRET_LIMITS.items)
        return yield* archiveFailure(new Error(sourceText("error.import.transferSecretTooLarge")));
      const privateKey = this.#keys.take(owner, migrationId);
      if (!privateKey) return yield* archiveFailure(new Error(sourceText("error.import.transferSecretKeyExpired")));
      const outcomes: InstanceTransferSecretOutcome[] = [];
      try {
        for (const item of items) {
          const result = yield* Effect.result(this.#applyOne(item, privateKey, migrationId));
          outcomes.push(
            Result.isSuccess(result)
              ? result.success
              : {
                  id: item.id,
                  kind: item.kind,
                  label: item.label,
                  status: "failed",
                  reason: sourceText("error.import.transferSecretApply"),
                },
          );
        }
        return { outcomes };
      } finally {
        privateKey.fill(0);
      }
    });
  }

  #applyOne(
    item: InstanceTransferSealedItem,
    privateKey: Buffer,
    migrationId: string,
  ): Effect.Effect<InstanceTransferSecretOutcome, unknown> {
    return Effect.gen({ self: this }, function* () {
      const opened = openValue(item, privateKey, migrationId, item.id);
      if (!opened) return failed(item, "error.import.transferSecretInvalid");
      try {
        let parsed: unknown;
        try {
          parsed = JSON.parse(opened.toString("utf8"));
        } catch {
          return failed(item, "error.import.transferSecretInvalid");
        }
        const payload = secretPayload(parsed);
        if (!payload) return failed(item, "error.import.transferSecretInvalid");
        // The kind travels with the item, and the payload must agree with it.
        if (payload.version !== 1 || payload.kind !== item.kind)
          return failed(item, "error.import.transferSecretInvalid");

        switch (item.kind) {
          case "provider-key": {
            const provider = payload.provider;
            if (!isAgentProvider(provider))
              return {
                ...base(item),
                status: "target-missing",
                reason: sourceText("error.import.transferSecretProviderUnknown"),
              };
            const apiKey = text(payload.apiKey);
            if (!apiKey) return failed(item, "error.import.transferSecretInvalid");
            if (this.sources.providers.get(provider) !== null)
              return { ...base(item), status: "already-present", reason: null };
            const saved = yield* Effect.result(this.sources.providers.set(provider, apiKey));
            return Result.isSuccess(saved) ? transferred(item) : failed(item, "error.import.transferSecretApply");
          }
          case "mcp-values":
            // MCP values are plaintext in SQLite on this build. They must stay on the source until
            // that store encrypts them with the target's system key.
            return failed(item, "error.import.transferSecretUnsupported");
          case "custom-provider": {
            const id = text(payload.id, 256);
            const origin = text(payload.origin, 512);
            const apiKey = optionalText(payload.apiKey);
            const headers = customHeaders(payload.headers);
            if (!id || !origin || apiKey === undefined || !headers)
              return failed(item, "error.import.transferSecretInvalid");
            const provider = this.sources.customProviders().find((candidate) => candidate.id === id);
            if (!provider || providerOrigin(provider.baseUrl) !== origin)
              return {
                ...base(item),
                status: "target-missing",
                reason: sourceText("error.import.transferSecretCustomProviderMissing"),
              };
            registerCustomProviderSecrets(provider);
            const mergedApiKey = provider.apiKey ?? apiKey;
            const mergedHeaders = mergeCustomHeaders(provider.headers, headers);
            const apiKeyChanged = mergedApiKey !== provider.apiKey;
            const headersChanged =
              mergedHeaders.length !== provider.headers.length ||
              mergedHeaders.some(
                (header, index) =>
                  header.name !== provider.headers[index]?.name || header.value !== provider.headers[index]?.value,
              );
            if (!apiKeyChanged && !headersChanged) return { ...base(item), status: "already-present", reason: null };
            const updated = yield* Effect.result(
              this.sources.updateCustomProvider({
                id: provider.id,
                name: provider.name,
                baseUrl: provider.baseUrl,
                models: provider.models.map((model) => ({ ...model })),
                ...(apiKeyChanged ? { apiKey: mergedApiKey ?? "" } : {}),
                ...(headersChanged ? { headers: mergedHeaders } : {}),
              }),
            );
            return Result.isSuccess(updated) ? transferred(item) : failed(item, "error.import.transferSecretApply");
          }
          case "github": {
            const session = githubSession(payload.session);
            if (!session) return failed(item, "error.import.transferSecretInvalid");
            if (this.sources.github.session() !== null)
              return { ...base(item), status: "already-present", reason: null };
            const adopted = yield* Effect.result(this.sources.github.adoptSession(session));
            return Result.isSuccess(adopted) ? transferred(item) : failed(item, "error.import.transferSecretGithub");
          }
          case "onepassword": {
            const token = text(payload.token);
            if (!token) return failed(item, "error.import.transferSecretInvalid");
            if (this.sources.onePassword.serviceAccountToken() !== null)
              return { ...base(item), status: "already-present", reason: null };
            yield* Effect.result(this.sources.onePassword.connectWithToken(token));
            // The connector keeps a rejected token in its status instead of failing the effect.
            return this.sources.onePassword.connected()
              ? transferred(item)
              : failed(item, "error.import.transferSecretOnePassword");
          }
          default:
            // A sign-in item is never sealed; one that arrives here is refused.
            return failed(item, "error.import.transferSecretUnsupported");
        }
      } finally {
        opened.fill(0);
      }
    });
  }

  /**
   * Every listed secret with the payload `seal` may send. The list is read again at seal time, so a
   * secret removed after the user chose it is reported instead of sent stale.
   */
  #inventory(): InventoryEntry[] {
    const entries: InventoryEntry[] = [];
    const saved = new Set(this.sources.providers.saved());
    const signedIn = new Set(this.sources.signedInProviders());
    for (const provider of AGENT_PROVIDERS) {
      const label = agentProviderDescriptor(provider).displayName;
      if (saved.has(provider)) {
        const apiKey = this.sources.providers.get(provider);
        if (apiKey === null) continue;
        entries.push({
          summary: {
            id: itemId("provider-key", provider),
            kind: "provider-key",
            label,
            count: 1,
            section: "providers",
            transferable: true,
          },
          payload: { version: 1, kind: "provider-key", provider, apiKey },
        });
        continue;
      }
      if (signedIn.has(provider)) {
        entries.push({
          summary: {
            id: itemId("provider-sign-in", provider),
            kind: "provider-sign-in",
            label,
            count: 1,
            section: "providers",
            transferable: false,
          },
          payload: null,
        });
      }
    }

    for (const server of this.sources.mcp.list()) {
      const env = server.env.filter((pair) => pair.value !== "");
      const headers = server.headers.filter((pair) => pair.value !== "");
      if (env.length === 0 && headers.length === 0) continue;
      entries.push({
        summary: {
          id: itemId("mcp-values", server.name),
          kind: "mcp-values",
          label: server.name,
          count: env.length + headers.length,
          section: "mcp",
          // This build's MCP store serializes env and headers as plaintext JSON. Never seal and
          // write them until the destination has an encrypted at-rest store.
          transferable: false,
        },
        payload: null,
      });
    }

    const github = this.sources.github.session();
    if (github) {
      entries.push({
        summary: {
          id: "github",
          kind: "github",
          label: `GitHub (@${github.login})`,
          count: 1,
          section: "connectors",
          transferable: true,
        },
        payload: { version: 1, kind: "github", session: github },
      });
    }

    const token = this.sources.onePassword.serviceAccountToken();
    if (token !== null) {
      entries.push({
        summary: {
          id: "onepassword",
          kind: "onepassword",
          label: "1Password service account",
          count: 1,
          section: "connectors",
          transferable: true,
        },
        payload: { version: 1, kind: "onepassword", token },
      });
    }

    for (const provider of this.sources.customProviders()) {
      registerCustomProviderSecrets(provider);
      const apiKey = provider.apiKey;
      const headers = provider.headers.filter((header) => header.value !== "");
      if (!apiKey && headers.length === 0) continue;
      const origin = providerOrigin(provider.baseUrl);
      if (!origin) continue;
      entries.push({
        summary: {
          id: itemId("custom-provider", provider.id),
          kind: "custom-provider",
          label: provider.name,
          count: Number(Boolean(apiKey)) + headers.length,
          section: "providers",
          transferable: true,
        },
        payload: {
          version: 1,
          kind: "custom-provider",
          id: provider.id,
          origin,
          apiKey,
          headers: headers.map((header) => ({ ...header })),
        },
      });
    }

    for (const resource of this.sources.mcpSignIns()) {
      entries.push({
        summary: {
          id: itemId("mcp-sign-in", resource),
          kind: "mcp-sign-in",
          label: resource,
          count: 1,
          section: "mcp",
          transferable: false,
        },
        payload: null,
      });
    }

    if (this.sources.bitwardenConnected()) {
      entries.push({
        summary: {
          id: "bitwarden",
          kind: "bitwarden",
          label: "Bitwarden",
          count: 1,
          section: "connectors",
          transferable: false,
        },
        payload: null,
      });
    }

    return entries;
  }
}

function base(item: InstanceTransferSealedItem) {
  return { id: item.id, kind: item.kind, label: item.label };
}

function transferred(item: InstanceTransferSealedItem): InstanceTransferSecretOutcome {
  return { ...base(item), status: "transferred", reason: null };
}

function failed(
  item: InstanceTransferSealedItem,
  reason: Extract<keyof SourceMessages, `error.import.transferSecret${string}`>,
): InstanceTransferSecretOutcome {
  return { ...base(item), status: "failed", reason: sourceText(reason) };
}

/** Fill only blank or absent target headers; a destination value always takes precedence. */
function mergeCustomHeaders(
  current: readonly CustomProviderHeader[],
  incoming: readonly CustomProviderHeader[],
): CustomProviderHeader[] {
  const headers = current.map((header) => ({ ...header }));
  const indexByName = new Map(headers.map((header, index) => [header.name.toLowerCase(), index]));
  for (const header of incoming) {
    const index = indexByName.get(header.name.toLowerCase());
    if (index === undefined) {
      indexByName.set(header.name.toLowerCase(), headers.length);
      headers.push({ ...header });
    } else if (!headers[index]?.value) {
      headers[index] = { ...header };
    }
  }
  return headers;
}

function registerCustomProviderSecrets(provider: CustomProviderConfig): void {
  if (provider.apiKey) registerSecretValue(provider.apiKey);
  for (const header of provider.headers) if (header.value) registerSecretValue(header.value);
}
