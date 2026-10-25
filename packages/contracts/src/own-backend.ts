/**
 * The services this build talks to: the public website, the account service, Signal, team hosts,
 * analytics and the desktop update feed.
 *
 * An OpenBot build that a person runs for their own use sets these settings at build time, and
 * nothing else needs to change. The defaults are placeholders under the reserved `.invalid` domain.
 * They never resolve, so a build that sets nothing fails closed: it cannot reach the upstream
 * project's services. Analytics, the status link, the Discord link and the auto-update feed are
 * off unless their setting is non-empty.
 *
 * This module has no imports, so the desktop main process, the preload script, the renderer, the
 * account Worker, Signal and the team client can all read it. Every read below is a literal
 * `process.env.NAME` inside `readOwnBackendEnvironment`, so a bundler `define` can replace it, and
 * `ownBackendBuildDefines` writes those replacements. A runtime without `process` (a Worker, or a
 * browser bundle that has no define) reads the placeholder instead.
 *
 * A Worker that reads its settings from bindings calls `resolveOwnBackend(env)` with them.
 */

// This package has no Node types, and `declare` emits nothing: the reads below use the runtime's
// `process` where one exists. The module-scope declaration only shadows the global in this file.
declare const process: { readonly env: Readonly<Record<string, string | undefined>> };

export const OWN_BACKEND_ENVIRONMENT_KEYS = [
  "OPENBOT_SITE_URL",
  "OPENBOT_ACCOUNT_URL",
  "OPENBOT_SIGNAL_URL",
  "OPENBOT_TEAM_HOST_DOMAIN",
  "OPENBOT_ANALYTICS_URL",
  "OPENBOT_ANALYTICS_CLIENT_ID",
  "OPENBOT_UPDATE_FEED_URL",
  "OPENBOT_STATUS_URL",
  "OPENBOT_DISCORD_URL",
  "OPENBOT_CONTACT_EMAIL",
] as const;

export type OwnBackendEnvironmentKey = (typeof OWN_BACKEND_ENVIRONMENT_KEYS)[number];
export type OwnBackendEnvironment = Partial<Record<OwnBackendEnvironmentKey, string | undefined>>;

/** The placeholders a build uses when a setting is empty. Every one is on the reserved `.invalid` domain. */
export const OWN_BACKEND_PLACEHOLDERS = {
  siteOrigin: "https://openbot.invalid",
  accountOrigin: "https://account.openbot.invalid",
  signalUrl: "wss://signal.openbot.invalid/v1/signal",
  teamHostDomain: "openbot.invalid",
  contactEmail: "contact@openbot.invalid",
} as const;

export interface OwnBackend {
  /** The public website: invitation, plugin and agent share links, canonical redirects. */
  readonly siteOrigin: string;
  /** The account Worker: sign-in, accounts, avatars, host configuration and invitations. */
  readonly accountOrigin: string;
  /** The Signal socket: remote sessions, relays, and the Slack, Discord and Telegram routes. */
  readonly signalUrl: string;
  /** The domain of team hosts: `<slug>-<id>-host.<domain>`. */
  readonly teamHostDomain: string;
  /** OpenPanel tracking, or `null` when analytics is off. */
  readonly analytics: { readonly apiUrl: string; readonly clientId: string } | null;
  /** The desktop update feed, or `null` when auto-update is off. */
  readonly updateFeedUrl: string | null;
  /** The status page origin, or `null` when the link is off. */
  readonly statusOrigin: string | null;
  /** The Discord community URL, or `null` when the link is off. */
  readonly discordUrl: string | null;
  /** The address that contact links and contact pages name. */
  readonly contactEmail: string;
}

/** A build setting that is set but invalid. The message names the setting and never its value. */
export class OwnBackendSettingError extends Error {
  readonly setting: OwnBackendEnvironmentKey;

  constructor(setting: OwnBackendEnvironmentKey, requirement: string) {
    super(`${setting} ${requirement}.`);
    this.name = "OwnBackendSettingError";
    this.setting = setting;
  }
}

/**
 * Resolves the settings. An empty value means the default. Throws `OwnBackendSettingError` for a
 * value that is set but unusable, so a misconfigured build fails at start-up rather than running
 * against the wrong service.
 */
export function resolveOwnBackend(environment: OwnBackendEnvironment): OwnBackend {
  const siteOrigin = originSetting(environment, "OPENBOT_SITE_URL", OWN_BACKEND_PLACEHOLDERS.siteOrigin);
  const accountOrigin = originSetting(environment, "OPENBOT_ACCOUNT_URL", OWN_BACKEND_PLACEHOLDERS.accountOrigin);
  const signalUrl = signalSetting(environment, "OPENBOT_SIGNAL_URL", OWN_BACKEND_PLACEHOLDERS.signalUrl);
  const teamHostDomain = domainSetting(
    environment,
    "OPENBOT_TEAM_HOST_DOMAIN",
    OWN_BACKEND_PLACEHOLDERS.teamHostDomain,
  );
  const analyticsUrl = optionalUrlSetting(environment, "OPENBOT_ANALYTICS_URL");
  const analyticsClientId = trimmed(environment.OPENBOT_ANALYTICS_CLIENT_ID);
  if (analyticsClientId !== null && !/^[A-Za-z0-9-]{8,80}$/u.test(analyticsClientId)) {
    throw new OwnBackendSettingError("OPENBOT_ANALYTICS_CLIENT_ID", "must be an OpenPanel client id");
  }
  return {
    siteOrigin,
    accountOrigin,
    signalUrl,
    teamHostDomain,
    analytics:
      analyticsUrl !== null && analyticsClientId !== null
        ? { apiUrl: analyticsUrl, clientId: analyticsClientId }
        : null,
    updateFeedUrl: optionalUrlSetting(environment, "OPENBOT_UPDATE_FEED_URL"),
    statusOrigin: optionalOriginSetting(environment, "OPENBOT_STATUS_URL"),
    discordUrl: optionalOriginSetting(environment, "OPENBOT_DISCORD_URL"),
    contactEmail: emailSetting(environment, "OPENBOT_CONTACT_EMAIL", OWN_BACKEND_PLACEHOLDERS.contactEmail),
  };
}

/**
 * The build-time settings of this process. Each read is a literal `process.env.NAME`, so a bundler
 * can replace it. A read that throws (no `process`, as in a Worker) yields `undefined`.
 */
export function readOwnBackendEnvironment(): OwnBackendEnvironment {
  return {
    OPENBOT_SITE_URL: safeRead(() => process.env.OPENBOT_SITE_URL),
    OPENBOT_ACCOUNT_URL: safeRead(() => process.env.OPENBOT_ACCOUNT_URL),
    OPENBOT_SIGNAL_URL: safeRead(() => process.env.OPENBOT_SIGNAL_URL),
    OPENBOT_TEAM_HOST_DOMAIN: safeRead(() => process.env.OPENBOT_TEAM_HOST_DOMAIN),
    OPENBOT_ANALYTICS_URL: safeRead(() => process.env.OPENBOT_ANALYTICS_URL),
    OPENBOT_ANALYTICS_CLIENT_ID: safeRead(() => process.env.OPENBOT_ANALYTICS_CLIENT_ID),
    OPENBOT_UPDATE_FEED_URL: safeRead(() => process.env.OPENBOT_UPDATE_FEED_URL),
    OPENBOT_STATUS_URL: safeRead(() => process.env.OPENBOT_STATUS_URL),
    OPENBOT_DISCORD_URL: safeRead(() => process.env.OPENBOT_DISCORD_URL),
    OPENBOT_CONTACT_EMAIL: safeRead(() => process.env.OPENBOT_CONTACT_EMAIL),
  };
}

/**
 * The bundler `define` entries for the settings, from the build's environment. Pass the result to
 * `define` in every build that bundles this module (desktop main, preload and renderer, and the
 * account Worker's build). A missing setting becomes an empty string, which resolves to the default.
 */
export function ownBackendBuildDefines(environment: Record<string, string | undefined>): Record<string, string> {
  const defines: Record<string, string> = {};
  for (const key of OWN_BACKEND_ENVIRONMENT_KEYS) {
    defines[`process.env.${key}`] = JSON.stringify(environment[key] ?? "");
  }
  return defines;
}

/** The process-wide settings, resolved once. Throws if a set value is invalid. */
let resolved: OwnBackend | undefined;
export function ownBackend(): OwnBackend {
  resolved ??= resolveOwnBackend(readOwnBackendEnvironment());
  return resolved;
}

function safeRead(read: () => string | undefined): string | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

function trimmed(value: string | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

function originSetting(environment: OwnBackendEnvironment, key: OwnBackendEnvironmentKey, fallback: string): string {
  const value = trimmed(environment[key]) ?? fallback;
  const url = parseUrl(value, key, "must be an absolute https URL");
  if (
    !isSecureOrLoopback(url, ["https:"]) ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  ) {
    throw new OwnBackendSettingError(key, "must be an https origin with no path");
  }
  return url.origin;
}

function signalSetting(environment: OwnBackendEnvironment, key: OwnBackendEnvironmentKey, fallback: string): string {
  const value = trimmed(environment[key]) ?? fallback;
  const url = parseUrl(value, key, "must be a wss URL");
  if (!isSecureOrLoopback(url, ["wss:", "ws:"]) || url.username || url.password || url.search || url.hash) {
    throw new OwnBackendSettingError(key, "must be a wss URL with no credentials");
  }
  return url.toString();
}

function emailSetting(environment: OwnBackendEnvironment, key: OwnBackendEnvironmentKey, fallback: string): string {
  const value = trimmed(environment[key]) ?? fallback;
  if (!/^[^\s@<>,;:"]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/iu.test(value)) {
    throw new OwnBackendSettingError(key, "must be an email address");
  }
  return value;
}

function domainSetting(environment: OwnBackendEnvironment, key: OwnBackendEnvironmentKey, fallback: string): string {
  const value = (trimmed(environment[key]) ?? fallback).toLowerCase();
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/u.test(value)) {
    throw new OwnBackendSettingError(key, "must be a domain name");
  }
  return value;
}

function optionalUrlSetting(environment: OwnBackendEnvironment, key: OwnBackendEnvironmentKey): string | null {
  const value = trimmed(environment[key]);
  if (value === null) return null;
  const url = parseUrl(value, key, "must be an absolute https URL");
  if (!isSecureOrLoopback(url, ["https:"]) || url.username || url.password || url.search || url.hash) {
    throw new OwnBackendSettingError(key, "must be an https URL with no credentials");
  }
  return url.toString();
}

function optionalOriginSetting(environment: OwnBackendEnvironment, key: OwnBackendEnvironmentKey): string | null {
  const value = trimmed(environment[key]);
  return value === null ? null : originSetting(environment, key, value);
}

function parseUrl(value: string, key: OwnBackendEnvironmentKey, requirement: string): URL {
  try {
    return new URL(value);
  } catch {
    throw new OwnBackendSettingError(key, requirement);
  }
}

// Plain HTTP is allowed only to a loopback host, so a developer can point a build at a local account
// service. Any other host must be reached over TLS.
function isSecureOrLoopback(url: URL, protocols: readonly string[]): boolean {
  if (protocols.includes(url.protocol)) return true;
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  return loopback && (url.protocol === "http:" || url.protocol === "ws:");
}
