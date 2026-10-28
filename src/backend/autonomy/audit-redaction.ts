import { redactText } from "@openbot/logging";

/** The longest text one audit row keeps. A longer command is cut, with a marker. */
export const AUDIT_TEXT_LIMIT = 400;

/**
 * Flags that take a secret as their next word, as in `--token abc`. `redactText` masks the
 * `name=value` and `name: value` forms, so this covers the space-separated form.
 */
const SECRET_FLAG = /(--?(?:token|password|passwd|secret|api-?key|apikey|auth|credential)s?)(\s+|=)(\S+)/gi;
/** Drops the characters below the space and the delete character. A line break is replaced before this runs. */
function withoutControlCharacters(value: string): string {
  let kept = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code >= 32 && code !== 127) kept += character;
  }
  return kept;
}

/**
 * The text an audit row keeps: secrets masked, control characters removed, one line, at most
 * `AUDIT_TEXT_LIMIT` characters. Every audit write goes through this function.
 */
export function redactAuditText(value: string): string {
  const masked = redactText(value).replace(SECRET_FLAG, (_match, flag: string, separator: string) => {
    return `${flag}${separator}[redacted]`;
  });
  const oneLine = withoutControlCharacters(masked.replace(/\s*\n\s*/g, " ").replace(/\t/g, " "));
  return oneLine.length > AUDIT_TEXT_LIMIT ? `${oneLine.slice(0, AUDIT_TEXT_LIMIT - 1)}…` : oneLine;
}
