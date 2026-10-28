import { redactText } from "@openbot/logging";

/** The longest text one audit row keeps. A longer command is cut, with a marker. */
export const AUDIT_TEXT_LIMIT = 400;

/**
 * Flags that take a secret as their next word, as in `--token abc`. `redactText` masks the
 * `name=value` and `name: value` forms, so this covers the space-separated form.
 */
const SECRET_FLAG = /(--?(?:token|password|passwd|secret|api-?key|apikey|auth|credential)s?)(\s+|=)(\S+)/gi;
/**
 * A budget field with a number or null, as in `"tokens":5000`. The serialized budgets of a
 * `budgets.changed` row hold these. `redactText` masks the value of any key named like `tokens`,
 * which would hide the limit the person set, and a number or null is never a secret. A string value
 * under the same key does not match, so a real secret there is still masked.
 */
const BUDGET_NUMBER_FIELD = /"(tokens|minutes|costUsd)"(\s*):(\s*)(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|null)(?=\s*[,}])/g;
const BUDGET_KEY_PLACEHOLDER = /"openbot_budget_field_(\d+)"/g;

/** Masks secrets with `redactText`, and keeps each numeric budget field as it was. */
function redactKeepingBudgetNumbers(value: string): string {
  const keys: string[] = [];
  const protectedText = value.replace(
    BUDGET_NUMBER_FIELD,
    (_field: string, key: string, before: string, after: string, number: string) => {
      keys.push(key);
      return `"openbot_budget_field_${keys.length - 1}"${before}:${after}${number}`;
    },
  );
  const masked = redactText(protectedText);
  if (keys.length === 0) return masked;
  return masked.replace(BUDGET_KEY_PLACEHOLDER, (placeholder: string, index: string) => {
    const key = keys[Number(index)];
    return key === undefined ? placeholder : `"${key}"`;
  });
}

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
  const masked = redactKeepingBudgetNumbers(value).replace(SECRET_FLAG, (_match, flag: string, separator: string) => {
    return `${flag}${separator}[redacted]`;
  });
  const oneLine = withoutControlCharacters(masked.replace(/\s*\n\s*/g, " ").replace(/\t/g, " "));
  return oneLine.length > AUDIT_TEXT_LIMIT ? `${oneLine.slice(0, AUDIT_TEXT_LIMIT - 1)}…` : oneLine;
}
