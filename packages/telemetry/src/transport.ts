import { ownBackend } from "@openbot/contracts/own-backend";
import { type ReportTransport, telemetryIO } from "./queue";

/**
 * The OpenPanel track endpoint. Without an explicit `endpoint`, it is the build's analytics setting
 * (`OPENBOT_ANALYTICS_URL`). A build with analytics off has no endpoint, so the transport refuses to send.
 */
export function openPanelTransport(options: {
  clientId: string;
  clientSecret?: string;
  origin?: string;
  endpoint?: string;
  fetch?: typeof fetch;
}): ReportTransport {
  const send = options.fetch ?? globalThis.fetch;
  const analytics = ownBackend().analytics;
  const endpoint = options.endpoint ?? (analytics ? `${analytics.apiUrl.replace(/\/$/u, "")}/track` : null);
  return (report, signal) =>
    telemetryIO(async () => {
      if (endpoint === null) throw new Error("Analytics is off in this build.");
      const response = await send(endpoint, {
        method: "POST",
        signal,
        credentials: "omit",
        referrerPolicy: "no-referrer",
        headers: {
          "content-type": "application/json",
          "openpanel-client-id": options.clientId,
          ...(options.clientSecret ? { "openpanel-client-secret": options.clientSecret } : {}),
          ...(options.origin ? { origin: options.origin } : {}),
        },
        body: JSON.stringify({
          type: "track",
          payload: {
            name: report.name,
            ...(report.profileId ? { profileId: report.profileId } : {}),
            properties: {
              ...report.properties,
              report_id: report.id,
              __timestamp: report.timestamp,
              surface: report.surface,
              environment: "production",
              app_version: report.app_version,
              platform: report.platform,
              event_schema_version: report.event_schema_version,
              __path: "",
              __referrer: "",
            },
          },
        }),
      });
      await response.body?.cancel();
      return response.status === 200 || response.status === 202;
    });
}
