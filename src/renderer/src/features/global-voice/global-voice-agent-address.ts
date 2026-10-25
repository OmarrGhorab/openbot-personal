/**
 * Voice routing by name: "Software Engineer, check the PR" goes to Software Engineer with "check the
 * PR". The match runs on this computer, against the agents' names and titles, and is tolerant of
 * speech-to-text slips: case, punctuation, Arabic letter variants, small spelling errors, and an
 * English name heard in Arabic letters ("سوفتوير انجنير"). It only switches on a confident match:
 * every word of a name must be heard, and a tie between two agents keeps the current target.
 */

export interface AddressableAgent {
  agentId: string;
  name: string;
  title?: string | undefined;
}

export interface AgentAddress {
  agentId: string;
  /** The message without the leading address. */
  text: string;
}

/** Words that may come before the name: "hey", "tell", "ask", and their Arabic equivalents. */
const LEAD_WORDS = new Set([
  "hey",
  "hi",
  "ok",
  "okay",
  "yo",
  "please",
  "tell",
  "ask",
  "to",
  "for",
  "dear",
  "يا",
  "قل",
  "قول",
  "قولي",
  "قوله",
  "اسال",
  "اسأل",
  "خلي",
  "لو",
  "سمحت",
  "ل",
]);

/** How far into the message a name may start, after the lead words. */
const MAX_LEAD_WORDS = 3;

/** Arabic letters to their nearest Latin consonant, for an English name heard in Arabic letters. */
const ARABIC_TO_LATIN: Readonly<Record<string, string>> = {
  ب: "b",
  ت: "t",
  ث: "s",
  ج: "g",
  ح: "h",
  خ: "k",
  د: "d",
  ذ: "z",
  ر: "r",
  ز: "z",
  س: "s",
  ش: "sh",
  ص: "s",
  ض: "d",
  ط: "t",
  ظ: "z",
  ع: "",
  غ: "g",
  ف: "f",
  ق: "k",
  ك: "k",
  ل: "l",
  م: "m",
  ن: "n",
  ه: "h",
  ء: "",
  ا: "",
  و: "",
  ي: "",
  ى: "",
  ئ: "",
  ؤ: "",
  ة: "",
  پ: "p",
  ڤ: "v",
  گ: "g",
};

/** Lower case, no diacritics or tatweel, one form of alef, ya and ta marbuta, letters and digits only. */
export function normalizeAddressWord(word: string): string {
  return word
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\p{M}|\u0640/gu, "")
    .replace(/[أإآٱ]/gu, "ا")
    .replace(/ى/gu, "ي")
    .replace(/ة/gu, "ه")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/** The consonant outline of a word, in Latin letters, so "engineer" and "انجنير" compare. */
function skeleton(word: string): string {
  let latin = "";
  for (const letter of word) latin += ARABIC_TO_LATIN[letter] ?? letter;
  return latin
    .replace(/ph/gu, "f")
    .replace(/[cq]/gu, "k")
    .replace(/[j]/gu, "g")
    .replace(/[v]/gu, "f")
    .replace(/x/gu, "ks")
    .replace(/[aeiouyw]/gu, "")
    .replace(/(.)\1+/gu, "$1");
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const saved = row[j] ?? 0;
      row[j] = Math.min((row[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = saved;
    }
  }
  return row[b.length] ?? 0;
}

/** Edits a heard word may differ by and still be the name's word. */
function allowance(length: number): 0 | 1 | 2 {
  if (length <= 3) return 0;
  if (length <= 6) return 1;
  return 2;
}

/** The cost of hearing `heard` for the name word `name`, or undefined when it is another word. */
function wordCost(heard: string, name: string): number | undefined {
  if (!heard || !name) return undefined;
  if (heard === name) return 0;
  const direct = editDistance(heard, name);
  if (direct <= allowance(name.length)) return direct;
  const a = skeleton(heard);
  const b = skeleton(name);
  if (a.length < 2 || b.length < 2) return undefined;
  const outline = editDistance(a, b);
  return outline <= (b.length <= 4 ? 1 : 2) ? outline + 0.5 : undefined;
}

interface Candidate {
  agentId: string;
  words: string[];
}

function candidates(agents: readonly AddressableAgent[]): Candidate[] {
  const list: Candidate[] = [];
  for (const agent of agents) {
    for (const label of [agent.name, agent.title]) {
      const words = (label ?? "").split(/\s+/u).map(normalizeAddressWord).filter(Boolean);
      if (words.length > 0) list.push({ agentId: agent.agentId, words });
    }
  }
  return list;
}

/**
 * The agent a dictated message is addressed to, and the message without the address. Undefined when
 * no name is heard at the start, when two agents match as well, or when nothing is left to send.
 */
export function matchAgentAddress(transcript: string, agents: readonly AddressableAgent[]): AgentAddress | undefined {
  const raw = transcript.trim().split(/\s+/u).filter(Boolean);
  const heard = raw.map(normalizeAddressWord);
  let best: { agentId: string; cost: number; end: number } | undefined;
  let tie = false;
  for (const candidate of candidates(agents)) {
    for (let start = 0; start <= Math.min(MAX_LEAD_WORDS, heard.length - 1); start += 1) {
      // Only lead words may come before the name.
      if (heard.slice(0, start).some((word) => word && !LEAD_WORDS.has(word))) break;
      let cost = 0;
      let matched = true;
      candidate.words.forEach((word, offset) => {
        if (!matched) return;
        const value = wordCost(heard[start + offset] ?? "", word);
        if (value === undefined) matched = false;
        else cost += value;
      });
      if (!matched) continue;
      const end = start + candidate.words.length;
      // A name of one short word is too easy to hear by chance.
      if (candidate.words.length === 1 && (candidate.words[0]?.length ?? 0) < 4) continue;
      const score = cost / candidate.words.length;
      if (!best || score < best.cost - 1e-9 || (Math.abs(score - best.cost) < 1e-9 && end > best.end)) {
        tie =
          best !== undefined &&
          best.agentId !== candidate.agentId &&
          Math.abs(score - best.cost) < 1e-9 &&
          end === best.end;
        best = { agentId: candidate.agentId, cost: score, end };
      } else if (Math.abs(score - best.cost) < 1e-9 && end === best.end && best.agentId !== candidate.agentId) {
        tie = true;
      }
      break;
    }
  }
  if (!best || tie) return undefined;
  const text = raw
    .slice(best.end)
    .join(" ")
    .replace(/^[\s,،:;.!?؟\-–—]+/u, "")
    .trim();
  if (!text) return undefined;
  return { agentId: best.agentId, text };
}
