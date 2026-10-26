import { chatTagReferences } from "./chat-tag-references";

/**
 * The most members that answer a message said to the whole channel ("hey guys", "everyone"). Each
 * answer is a full model turn, so a large channel would pay for every member on a greeting. Members
 * that the user names are not limited: the user chose each of them.
 */
export const CHANNEL_GENERAL_ANSWER_LIMIT = 3;

export interface AddressableMember {
  agentId: string;
  name: string;
}

/**
 * Whom a channel request addresses in its text.
 *
 * - `named`: the text names these members, in the order it names them. Each one answers.
 * - `everyone`: the text speaks to the whole channel. These members answer, the lead first and at
 *   most `CHANNEL_GENERAL_ANSWER_LIMIT`.
 * - `ambiguous`: a name in the text belongs to more than one member, so only the user can choose.
 * - `unaddressed`: the text names nobody. The lead decides who owns it.
 */
export type ChannelAddress =
  | { kind: "named"; agentIds: string[] }
  | { kind: "everyone"; agentIds: string[] }
  | { kind: "ambiguous"; name: string; agentIds: string[] }
  | { kind: "unaddressed" };

/** Words that open a message and say nothing of their own. A message of only these is a greeting. */
const GREETINGS = new Set([
  "hey",
  "hi",
  "hello",
  "hiya",
  "yo",
  "morning",
  "evening",
  "afternoon",
  "good",
  "dear",
  "اهلا",
  "أهلا",
  "مرحبا",
  "هاي",
  "صباح",
  "مساء",
  "الخير",
  "النور",
  "السلام",
  "عليكم",
  "يا",
]);

/** Words that speak to the whole channel wherever they stand. */
const GROUP_WORDS = new Set([
  "everyone",
  "everybody",
  "guys",
  "folks",
  "yall",
  "شباب",
  "جماعة",
  "الجماعة",
  "الجميع",
  "كلكم",
]);

/**
 * Words that speak to the whole channel only as the first word after a greeting ("hi all"), or as
 * the first word of the message before a comma or colon ("team, check this"). Elsewhere they are
 * ordinary words: "fix all the tests" is a task, not a general message.
 */
const VOCATIVE_WORDS = new Set(["all", "team", "people", "both"]);

/** Word sequences that speak to the whole channel wherever they stand. */
const GROUP_PHRASES = [
  ["all", "of", "you"],
  ["you", "all"],
  ["y", "all"],
  ["both", "of", "you"],
  ["you", "both"],
  ["you", "two"],
];

/** Lower-case words of the text: letters, marks and digits. Everything else separates them. */
function addressWords(text: string): string[] {
  return (
    text
      .normalize("NFKC")
      .toLocaleLowerCase()
      .match(/[\p{L}\p{M}\p{N}]+/gu) ?? []
  );
}

/**
 * The text that can address a member. Chat tags are removed: a leading member tag is already the
 * explicit recipient, and a tag later in the text, a quote or a skill is a reference, not an address.
 * Quoted Markdown lines, quoted strings and code are someone else's words.
 */
function addressText(text: string): string {
  let result = "";
  let index = 0;
  for (const reference of chatTagReferences(text)) {
    result += `${text.slice(index, reference.start)} `;
    index = reference.end;
  }
  result += text.slice(index);
  return result
    .split("\n")
    .filter((line) => !line.trimStart().startsWith(">"))
    .join("\n")
    .replace(/```[\s\S]*?```|`[^`\n]*`|"[^"\n]*"|“[^”\n]*”/gu, " ");
}

function startsAt(words: readonly string[], phrase: readonly string[], index: number): boolean {
  return phrase.every((word, offset) => words[index + offset] === word);
}

function generalAddress(text: string, words: readonly string[]): boolean {
  let first = 0;
  while (first < words.length && GREETINGS.has(words[first] ?? "")) first += 1;
  // A message of greetings only ("hey", "good morning") is said to the whole channel.
  if (words.length > 0 && first === words.length) return true;
  const vocative = words[first] ?? "";
  if (VOCATIVE_WORDS.has(vocative)) {
    if (first > 0) return true;
    if (new RegExp(`^\\s*${vocative}\\s*[,:،]`, "iu").test(text.normalize("NFKC"))) return true;
  }
  return words.some(
    (word, index) => GROUP_WORDS.has(word) || GROUP_PHRASES.some((phrase) => startsAt(words, phrase, index)),
  );
}

/**
 * Reads whom a channel request addresses. Names match case-insensitively as whole words. A longer
 * name wins over a shorter name inside it ("Software Engineer 2" over "Software Engineer"). Two
 * members with the same name make that name ambiguous. Names win over a general address: "hey guys,
 * Worker Engineer can you check" goes to Worker Engineer only.
 *
 * `members` are the eligible members with the lead first. A general address takes the first
 * `limit` of them.
 */
export function channelAddress(
  text: string,
  members: readonly AddressableMember[],
  limit = CHANNEL_GENERAL_ANSWER_LIMIT,
): ChannelAddress {
  const plain = addressText(text);
  const words = addressWords(plain);
  const byName = new Map<string, { words: string[]; agentIds: string[]; name: string }>();
  for (const member of members) {
    const nameWords = addressWords(member.name);
    if (!nameWords.length) continue;
    const key = nameWords.join(" ");
    const known = byName.get(key);
    if (known) known.agentIds.push(member.agentId);
    else byName.set(key, { words: nameWords, agentIds: [member.agentId], name: member.name });
  }
  const matches: { agentIds: string[]; name: string; start: number; end: number }[] = [];
  for (const name of byName.values())
    for (let index = 0; index + name.words.length <= words.length; index += 1)
      if (startsAt(words, name.words, index))
        matches.push({ agentIds: name.agentIds, name: name.name, start: index, end: index + name.words.length });
  // The longest names claim their words first. A shorter name inside a claimed span is part of it.
  matches.sort((left, right) => right.end - right.start - (left.end - left.start) || left.start - right.start);
  const claimed: typeof matches = [];
  for (const match of matches)
    if (!claimed.some((other) => match.start < other.end && other.start < match.end)) claimed.push(match);
  const tied = claimed.find((match) => match.agentIds.length > 1);
  if (tied) return { kind: "ambiguous", name: tied.name, agentIds: [...tied.agentIds] };
  if (claimed.length) {
    const ordered = claimed.sort((left, right) => left.start - right.start).flatMap((match) => match.agentIds);
    return { kind: "named", agentIds: [...new Set(ordered)] };
  }
  if (members.length && generalAddress(plain, words))
    return { kind: "everyone", agentIds: members.slice(0, Math.max(1, limit)).map((member) => member.agentId) };
  return { kind: "unaddressed" };
}
