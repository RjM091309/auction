import type { AuctionItem, GuildMember } from '../types';

/**
 * IGN identity for queue rules: collapse spaces/case, prefix/suffix variants
 * (BKpancho / pancho), trailing digits (click / Click125), and 1-letter typos
 * with same first letter (Nakzu / Naksu).
 */

function isLettersOnlyCanonical(s: string): boolean {
  return s.length > 0 && /^[a-z]+$/.test(s);
}

/** Same letters-only base with digits appended on the longer name (click vs click125). */
function matchesDigitSuffixVariant(a: string, b: string): boolean {
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter === longer) return false;
  if (shorter.length < 4) return false;
  if (!isLettersOnlyCanonical(shorter)) return false;
  if (!longer.startsWith(shorter)) return false;
  const suffix = longer.slice(shorter.length);
  return suffix.length > 0 && /^\d+$/.test(suffix);
}

/** Longer IGN starts with shorter base + alphanumeric tag with digits (Arcteryx / Arcteryxx124124). */
function matchesPrefixExtensionVariant(a: string, b: string): boolean {
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter === longer) return false;
  if (shorter.length < 5) return false;
  if (!isLettersOnlyCanonical(shorter)) return false;
  if (!longer.startsWith(shorter)) return false;
  const suffix = longer.slice(shorter.length);
  if (suffix.length < 2 || suffix.length > 14) return false;
  if (!/^[a-z0-9]+$/.test(suffix)) return false;
  return /\d/.test(suffix);
}

/** Longer IGN ends with shorter tag (BKpancho vs pancho). */
function matchesEmbeddedSuffixVariant(a: string, b: string): boolean {
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter === longer) return false;
  if (shorter.length < 5) return false;
  if (!isLettersOnlyCanonical(shorter)) return false;
  if (!longer.endsWith(shorter)) return false;
  const prefix = longer.slice(0, longer.length - shorter.length);
  if (prefix.length === 0 || prefix.length > 8) return false;
  return /^[a-z0-9]+$/.test(prefix);
}

export function canonicalIgnKey(raw: string): string {
  return String(raw ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const rows = a.length + 1;
  const cols = b.length + 1;
  let prev = new Array<number>(cols);
  let curr = new Array<number>(cols);
  for (let j = 0; j < cols; j += 1) prev[j] = j;
  for (let i = 1; i < rows; i += 1) {
    curr[0] = i;
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const t = prev;
    prev = curr;
    curr = t;
  }
  return prev[cols - 1]!;
}

/** 1-char typo only when first letter matches (blocks pancho ↔ sancho). */
function matchesLevenshteinTypo(a: string, b: string): boolean {
  if (Math.min(a.length, b.length) < 4) return false;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (!isLettersOnlyCanonical(a) || !isLettersOnlyCanonical(b)) return false;
  if (a[0] !== b[0]) return false;
  return levenshtein(a, b) <= 1;
}

/** Lower = stronger match (used to pick best candidate). */
function matchStrength(
  a: string,
  b: string
): { tier: number; tieBreak: number } | null {
  if (!a || !b) return null;
  if (a === b) return { tier: 0, tieBreak: 0 };
  if (matchesDigitSuffixVariant(a, b)) {
    const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
    return { tier: 1, tieBreak: longer.length - shorter.length };
  }
  if (matchesPrefixExtensionVariant(a, b)) {
    const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
    return { tier: 2, tieBreak: longer.length - shorter.length };
  }
  if (matchesEmbeddedSuffixVariant(a, b)) {
    const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
    return { tier: 3, tieBreak: longer.length - shorter.length };
  }
  if (matchesLevenshteinTypo(a, b)) {
    return { tier: 4, tieBreak: levenshtein(a, b) };
  }
  return null;
}

/** Same person for queue slot limits (join blocking, Swal). */
export function ignMatchesForQueueIdentity(aRaw: string, bRaw: string): boolean {
  const a = canonicalIgnKey(aRaw);
  const b = canonicalIgnKey(bRaw);
  return matchStrength(a, b) != null;
}

/** Stricter dedupe — no Levenshtein (avoids dropping fire vs fires from queue). */
export function ignMatchesForQueueDedupe(aRaw: string, bRaw: string): boolean {
  const a = canonicalIgnKey(aRaw);
  const b = canonicalIgnKey(bRaw);
  if (!a || !b) return false;
  if (a === b) return true;
  if (matchesDigitSuffixVariant(a, b)) return true;
  if (matchesPrefixExtensionVariant(a, b)) return true;
  return matchesEmbeddedSuffixVariant(a, b);
}

/** Best-matching queued/roster name (not merely first fuzzy hit). */
export function findMatchingIgnName(
  targetRaw: string,
  candidates: Iterable<string>
): string | null {
  const target = canonicalIgnKey(targetRaw);
  if (!target) return null;

  let bestName: string | null = null;
  let bestTier = Number.POSITIVE_INFINITY;
  let bestTie = Number.POSITIVE_INFINITY;

  for (const c of candidates) {
    const cand = canonicalIgnKey(c);
    const strength = matchStrength(target, cand);
    if (!strength) continue;
    const { tier, tieBreak } = strength;
    if (
      tier < bestTier ||
      (tier === bestTier && tieBreak < bestTie)
    ) {
      bestTier = tier;
      bestTie = tieBreak;
      bestName = c;
    }
  }
  return bestName;
}

export function queueItemHasMatchingIgn(
  item: AuctionItem,
  members: GuildMember[],
  ignRaw: string
): boolean {
  return matchingIgnOnQueueItem(item, members, ignRaw) != null;
}

/** Queued IGN that matches `ignRaw` on this item (for similar-name Swal). */
export function matchingIgnOnQueueItem(
  item: AuctionItem,
  members: GuildMember[],
  ignRaw: string
): string | null {
  const names: string[] = [];
  for (const mid of item.interestedMemberIds) {
    const n = members.find((m) => m.id === mid)?.name;
    if (n?.trim()) names.push(n);
  }
  return findMatchingIgnName(ignRaw, names);
}

export function findMemberByIgnIdentity(
  members: GuildMember[],
  ignRaw: string
): GuildMember | undefined {
  const matchName = findMatchingIgnName(
    ignRaw,
    members.map((m) => m.name)
  );
  if (!matchName) return undefined;
  return members.find((m) => ignMatchesForQueueIdentity(m.name, matchName));
}
