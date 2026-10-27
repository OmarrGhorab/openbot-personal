import { rm } from "node:fs/promises";
import {
  decodeSealInstanceTransferSecretsResult,
  parseApplyInstanceTransferInput,
  parseExportInstanceInput,
} from "@openbot/contracts/ipc";
import {
  INSTANCE_TRANSFER_CAPABILITY,
  INSTANCE_TRANSFER_REMOTE_BYTES,
  INSTANCE_TRANSFER_ROUTES,
} from "@openbot/contracts/team-protocol/instance-transfer-v1";
import {
  INSTANCE_TRANSFER_V2_CAPABILITY,
  INSTANCE_TRANSFER_V2_ROUTES,
} from "@openbot/contracts/team-protocol/instance-transfer-v2";
import {
  INSTANCE_TRANSFER_V3_CAPABILITY,
  INSTANCE_TRANSFER_V3_ROUTES,
} from "@openbot/contracts/team-protocol/instance-transfer-v3";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { runCauseEffect } from "../../backend/effect-boundary";
import type { TeamApiInstanceTransfer } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readBinary, readJson, requireAdmin, stringField } from "./request-helpers";
import { answer } from "./route-agent-import";
import { sendFile } from "./route-files";

/** `INPUT_LIMITS.identifier`. The v3 codec bounds each id too; this checks it again before use. */
const isSecretId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 128;

const V1_ROUTES: ReadonlySet<string> = new Set(Object.values(INSTANCE_TRANSFER_ROUTES));
const V2_ROUTES: ReadonlySet<string> = new Set(Object.values(INSTANCE_TRANSFER_V2_ROUTES));
const V3_ROUTES: ReadonlySet<string> = new Set(Object.values(INSTANCE_TRANSFER_V3_ROUTES));
const ROUTES: ReadonlySet<string> = new Set([...V1_ROUTES, ...V2_ROUTES, ...V3_ROUTES]);

/**
 * The server's agents and server settings to or from an OpenBot transfer file. Only an owner or an
 * admin: an export holds every agent's memories and files, and an import adds server settings. The
 * token is the caller's own. Frozen by `instance-transfer-v1`; `instance-transfer-v2` adds the
 * migration id, the resumed flag and the rollback.
 */
export async function routeInstanceTransfer(
  context: TeamApiRequestContext,
  instanceTransfer: TeamApiInstanceTransfer | undefined,
  newAgentHidden: () => boolean,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, response, json } = context;
  if (method !== "POST" || !ROUTES.has(url.pathname)) return "unmatched";
  if (!instanceTransfer || !capabilities.has(INSTANCE_TRANSFER_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.instanceTransferUnsupported"));
  if (V2_ROUTES.has(url.pathname) && !capabilities.has(INSTANCE_TRANSFER_V2_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.instanceTransferUnsupported"));
  if (V3_ROUTES.has(url.pathname) && !capabilities.has(INSTANCE_TRANSFER_V3_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.instanceTransferUnsupported"));
  requireAdmin(member);

  switch (url.pathname) {
    case INSTANCE_TRANSFER_ROUTES.summary:
      return json(200, await answer(() => runCauseEffect(instanceTransfer.summary()), 400));
    case INSTANCE_TRANSFER_ROUTES.export: {
      let input: ReturnType<typeof parseExportInstanceInput>;
      try {
        input = parseExportInstanceInput(await readJson(request));
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : "Invalid export.");
      }
      const path = await answer(() => runCauseEffect(instanceTransfer.exportForMember(input)), 400);
      try {
        return await sendFile(response, path, null, (size) => ({
          "Content-Type": "application/zip",
          "Content-Length": String(size),
          "Content-Disposition": "attachment; filename*=UTF-8''openbot-transfer.zip",
          "X-Content-Type-Options": "nosniff",
        }));
      } finally {
        await rm(path, { force: true });
      }
    }
    case INSTANCE_TRANSFER_ROUTES.stage: {
      const read = () =>
        readBinary(request, INSTANCE_TRANSFER_REMOTE_BYTES).catch((error: unknown) => {
          if (error instanceof HttpError && error.status === 413)
            throw new HttpError(413, sourceText("error.import.transferRemoteTooLarge"));
          throw error;
        });
      return json(200, await answer(() => runCauseEffect(instanceTransfer.stageUpload(read, member.id)), 400));
    }
    case INSTANCE_TRANSFER_ROUTES.discard:
      await Effect.runPromise(instanceTransfer.discard(stringField(await readJson(request), "token"), member.id));
      return json(200, {});
    case INSTANCE_TRANSFER_V3_ROUTES.secrets:
      return json(200, await answer(() => runCauseEffect(instanceTransfer.listSecrets()), 400));
    case INSTANCE_TRANSFER_V3_ROUTES.key: {
      // `readJson` has already run the body through the v3 wire codec.
      const migrationId = stringField(await readJson(request), "migrationId");
      return json(
        200,
        await answer(() => runCauseEffect(instanceTransfer.createSecretKey(migrationId, member.id)), 409),
      );
    }
    case INSTANCE_TRANSFER_V3_ROUTES.seal: {
      const body = await readJson(request);
      const migrationId = stringField(body, "migrationId");
      const targetPublicKey = stringField(body, "targetPublicKey");
      const ids = body.ids;
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > 64 || !ids.every(isSecretId))
        throw new HttpError(400, sourceText("error.import.transferSecretInvalid"));
      return json(
        200,
        await answer(() => runCauseEffect(instanceTransfer.sealSecrets({ migrationId, targetPublicKey, ids })), 400),
      );
    }
    case INSTANCE_TRANSFER_V3_ROUTES.apply: {
      const body = await readJson(request);
      const migrationId = stringField(body, "migrationId");
      // The v3 wire codec read every field; this checks the bounds again before a key is used.
      const items = decodeSealInstanceTransferSecretsResult({ items: body.items, failed: [] }).items;
      return json(
        200,
        await answer(() => runCauseEffect(instanceTransfer.applySecrets(migrationId, items, member.id)), 409),
      );
    }
    case INSTANCE_TRANSFER_V2_ROUTES.rollback: {
      // `readJson` has already run the body through the v2 wire codec.
      const migrationId = stringField(await readJson(request), "migrationId");
      return json(200, await answer(() => runCauseEffect(instanceTransfer.rollback(migrationId, member.id)), 409));
    }
    default: {
      // `readJson` has already run the body through the instance-transfer wire codec.
      const body = await readJson(request);
      if (newAgentHidden()) throw new HttpError(400, sourceText("error.team.newAgentProviderLocalOnly"));
      let input: ReturnType<typeof parseApplyInstanceTransferInput>;
      try {
        input = parseApplyInstanceTransferInput(body);
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : "Invalid transfer.");
      }
      // The service checks the zone and uses the host's own when it is not valid.
      const timezone = typeof body.timezone === "string" ? body.timezone : undefined;
      const result = await answer(() => runCauseEffect(instanceTransfer.apply(input, member.id, timezone)), 409);
      return json(200, {
        ...result,
        agents: result.agents.map((agent) => ({ agentId: agent.id, name: agent.name })),
      });
    }
  }
}
