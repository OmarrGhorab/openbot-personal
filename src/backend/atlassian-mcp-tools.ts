import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { McpServerConfig } from "@openbot/contracts/ipc";
import { Effect, Schema } from "effect";
import { TicketSourceFailed } from "./agent-tickets/ticket-source";
import type {
  AtlassianIssue,
  AtlassianSite,
  AtlassianTools,
  AtlassianTransition,
} from "./board-tickets/jira-board-sync-source";
import { type McpOAuthAuthority, secureOAuthFetch } from "./mcp-oauth-provider";

/** The host of the Atlassian MCP server that the Marketplace adds. */
const ATLASSIAN_MCP_HOST = "mcp.atlassian.com";

/** One call must end, so a stalled server never holds a sync pass. */
const ATLASSIAN_CALL_TIMEOUT_MS = 30_000;

/** The issues of one pass. A page holds at most 100 issues. */
const OPEN_ISSUE_LIMIT = 100;

export interface AtlassianToolsOptions {
  /** The saved MCP servers. */
  servers: () => McpServerConfig[];
  /** The sign-in that OpenBot keeps for the server. The token is read for each call and never stored here. */
  oauth: Pick<McpOAuthAuthority, "accessToken" | "signedIn">;
}

/** The saved, enabled Atlassian MCP server, or null when the Marketplace has not added one. */
function atlassianServer(servers: readonly McpServerConfig[]): McpServerConfig | null {
  return (
    servers.find(
      (server) =>
        server.enabled &&
        server.transport === "http" &&
        URL.canParse(server.url) &&
        new URL(server.url).hostname === ATLASSIAN_MCP_HOST,
    ) ?? null
  );
}

/** Whether a Jira sync can run now: the server is saved and this computer holds its sign-in. */
export function atlassianConnected(options: AtlassianToolsOptions): boolean {
  const server = atlassianServer(options.servers());
  return server !== null && options.oauth.signedIn(server.url);
}

/** The arguments of the tools below. Only the fields that these calls send. */
type AtlassianToolArguments = {
  cloudId?: string;
  /** For `executeRead`: the operation to run. */
  name?: string;
  /** For `executeRead`: the input of the operation. */
  inputs?: { maxResults?: number; issueIdOrKey?: string };
  jql?: string;
  fields?: string[];
  maxResults?: number;
  issueIdOrKey?: string;
  commentBody?: string;
  transitionId?: string;
};

const siteSchema = Schema.Struct({
  resources: Schema.Array(
    Schema.Struct({
      cloudId: Schema.String,
      url: Schema.String,
      products: Schema.Array(Schema.Struct({ id: Schema.String })),
    }),
  ),
});
const projectsSchema = Schema.Struct({ values: Schema.Array(Schema.Struct({ key: Schema.String })) });
const issuesSchema = Schema.Struct({
  issues: Schema.Array(
    Schema.Struct({
      key: Schema.String,
      fields: Schema.Struct({
        summary: Schema.optional(Schema.String),
        description: Schema.optional(Schema.NullOr(Schema.String)),
      }),
    }),
  ),
});
const transitionsSchema = Schema.Struct({
  transitions: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      isAvailable: Schema.optional(Schema.Boolean),
      to: Schema.Struct({ statusCategory: Schema.Struct({ key: Schema.String }) }),
    }),
  ),
});
/** The text of a tool result as JSON, without the `data` envelope of the Atlassian server. */
const answerSchema = Schema.Struct({
  content: Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.optional(Schema.String) })),
});
const envelopeSchema = Schema.Struct({ data: Schema.Unknown });

/**
 * The SDK class declares its handlers as `T | undefined`, which `Transport` refuses under
 * `exactOptionalPropertyTypes`. This passes each call through and sends each event to the handlers
 * that the client sets on the result, so no assertion is needed.
 */
function connectable(inner: StreamableHTTPClientTransport): Transport {
  const transport: Transport = {
    start: () => inner.start(),
    send: (message, options) => inner.send(message, options),
    close: () => inner.close(),
    setProtocolVersion: (version) => inner.setProtocolVersion(version),
  };
  inner.onclose = () => transport.onclose?.();
  inner.onerror = (error) => transport.onerror?.(error);
  inner.onmessage = (message) => transport.onmessage?.(message);
  return transport;
}

/**
 * The Atlassian MCP server, called with the sign-in that the person made in the Marketplace. Each call
 * opens its own connection and closes it again, so no connection or token outlives the call. A failure
 * keeps its cause private; no message, token or response body reaches the person.
 */
export function createAtlassianTools(options: AtlassianToolsOptions): AtlassianTools {
  /** One tool call. The answer is the text of the result. */
  const call = (tool: string, args: AtlassianToolArguments): Effect.Effect<string, TicketSourceFailed> =>
    Effect.gen(function* () {
      const server = atlassianServer(options.servers());
      if (!server) return yield* new TicketSourceFailed({ cause: new Error("Atlassian is not connected.") });
      const token = yield* Effect.tryPromise({
        try: () => Effect.runPromise(options.oauth.accessToken(server.url)),
        catch: (cause) => new TicketSourceFailed({ cause }),
      });
      if (!token) return yield* new TicketSourceFailed({ cause: new Error("Atlassian needs a new sign-in.") });
      const text = yield* Effect.acquireUseRelease(
        Effect.sync(() => ({
          client: new Client({ name: "openbot-board-sync", version: "1" }, { capabilities: {} }),
          transport: connectable(
            new StreamableHTTPClientTransport(new URL(server.url), {
              fetch: secureOAuthFetch({ resource: server.url, mcpTraffic: true }),
              requestInit: { headers: { Authorization: `Bearer ${token}` } },
            }),
          ),
        })),
        ({ client, transport }) =>
          Effect.tryPromise({
            try: async (signal) => {
              await client.connect(transport, { signal });
              return await client.callTool({ name: tool, arguments: args }, undefined, {
                signal,
                timeout: ATLASSIAN_CALL_TIMEOUT_MS,
              });
            },
            catch: (cause) => new TicketSourceFailed({ cause }),
          }),
        ({ client }) => Effect.promise(() => client.close().catch(() => undefined)),
      ).pipe(
        Effect.flatMap((result) =>
          Schema.decodeUnknownEffect(answerSchema)(result).pipe(
            Effect.map((answer) => answer.content.find((part) => part.type === "text")?.text ?? ""),
            Effect.mapError((cause) => new TicketSourceFailed({ cause })),
          ),
        ),
      );
      return text;
    });

  /** A tool call that reads: its text is JSON in the `data` envelope, decoded by the schema. */
  const run = <A, I>(
    tool: string,
    args: AtlassianToolArguments,
    schema: Schema.Codec<A, I>,
  ): Effect.Effect<A, TicketSourceFailed> =>
    call(tool, args).pipe(
      Effect.flatMap((text) =>
        Effect.try({ try: (): unknown => JSON.parse(text), catch: (cause) => new TicketSourceFailed({ cause }) }),
      ),
      Effect.flatMap((json) => Schema.decodeUnknownEffect(envelopeSchema)(json)),
      Effect.flatMap((envelope) => Schema.decodeUnknownEffect(schema)(envelope.data)),
      Effect.mapError((cause) => (cause instanceof TicketSourceFailed ? cause : new TicketSourceFailed({ cause }))),
    );

  return {
    sites: () =>
      run("getAccessibleAtlassianResources", {}, siteSchema).pipe(
        Effect.map((answer): AtlassianSite[] =>
          answer.resources
            .filter((resource) => resource.products.some((product) => product.id === "jira"))
            .map((resource) => ({ cloudId: resource.cloudId, url: resource.url.replace(/\/+$/u, "") })),
        ),
      ),
    projects: (cloudId) =>
      run("executeRead", { name: "listJiraProjects", cloudId, inputs: { maxResults: 100 } }, projectsSchema).pipe(
        Effect.map((answer) => answer.values.map((project) => project.key)),
      ),
    openIssues: (cloudId, project) =>
      run(
        "searchJiraIssuesUsingJql",
        {
          cloudId,
          jql: `project = ${project} AND statusCategory != Done ORDER BY created DESC`,
          fields: ["summary", "description"],
          maxResults: OPEN_ISSUE_LIMIT,
        },
        issuesSchema,
      ).pipe(
        Effect.map((answer) =>
          answer.issues.map(
            (issue): AtlassianIssue => ({
              key: issue.key,
              summary: issue.fields.summary ?? "",
              description: issue.fields.description ?? "",
            }),
          ),
        ),
      ),
    comment: (cloudId, key, text) =>
      call("addOrEditJiraIssueComment", { cloudId, issueIdOrKey: key, commentBody: text }).pipe(Effect.asVoid),
    transitions: (cloudId, key) =>
      run(
        "executeRead",
        { name: "listJiraIssueTransitions", cloudId, inputs: { issueIdOrKey: key } },
        transitionsSchema,
      ).pipe(
        Effect.map((answer) =>
          answer.transitions
            .filter((transition) => transition.isAvailable !== false)
            .map(
              (transition): AtlassianTransition => ({ id: transition.id, category: transition.to.statusCategory.key }),
            ),
        ),
      ),
    transition: (cloudId, key, transitionId) =>
      call("transitionJiraIssue", { cloudId, issueIdOrKey: key, transitionId }).pipe(Effect.asVoid),
  };
}
