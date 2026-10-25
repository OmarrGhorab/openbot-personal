/**
 * The plural category of a count in a locale.
 *
 * `Intl.PluralRules` is used where the runtime has it. The mobile app runs on Hermes, which may not
 * ship it (not confirmed on a device), so each translated language also has its CLDR rule written
 * out here. A new language adds its rule to `BUILT_IN_RULES`; see docs/i18n.md.
 */

type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";

type PluralRule = (count: number) => PluralCategory;

// CLDR: one is the integer 1 with no visible fraction digits.
const english: PluralRule = (count) => (count === 1 ? "one" : "other");

const BUILT_IN_RULES: Readonly<Record<string, PluralRule>> = {
  en: english,
  // CLDR Arabic: zero for 0; one for 1; two for 2; few for 3–10 (mod 100); many for 11–99 (mod 100);
  // other for the rest and for fractions.
  ar: (count) => {
    const absolute = Math.abs(count);
    if (!Number.isInteger(absolute)) return "other";
    if (absolute === 0) return "zero";
    if (absolute === 1) return "one";
    if (absolute === 2) return "two";
    const lastTwo = absolute % 100;
    if (lastTwo >= 3 && lastTwo <= 10) return "few";
    if (lastTwo >= 11 && lastTwo <= 99) return "many";
    return "other";
  },
};

const rulesByLocale = new Map<string, Intl.PluralRules>();

function intlRules(locale: string): Intl.PluralRules | undefined {
  if (typeof Intl === "undefined" || typeof Intl.PluralRules !== "function") return undefined;
  const cached = rulesByLocale.get(locale);
  if (cached) return cached;
  // An unknown tag throws rather than falling back, and a bad stored preference must not blank the
  // interface. English rules are wrong for that language but still render a readable sentence.
  let rules: Intl.PluralRules;
  try {
    rules = new Intl.PluralRules(locale);
  } catch {
    rules = new Intl.PluralRules("en");
  }
  rulesByLocale.set(locale, rules);
  return rules;
}

export function pluralCategory(locale: string, count: number): PluralCategory {
  const rules = intlRules(locale);
  if (rules) return rules.select(count);
  const language = locale.split("-")[0]?.toLowerCase() ?? "";
  return (BUILT_IN_RULES[language] ?? english)(count);
}
