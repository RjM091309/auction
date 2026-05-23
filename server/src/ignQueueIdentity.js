/** Keep in sync with `src/lib/ignQueueIdentity.ts` */

/** @param {string} raw */
export function canonicalIgnKey(raw) {
  return String(raw ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

/** @param {string} a @param {string} b */
function levenshtein(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const rows = a.length + 1;
  const cols = b.length + 1;
  let prev = new Array(cols);
  let curr = new Array(cols);
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
  return prev[cols - 1];
}

/** @param {string} s */
function isLettersOnlyCanonical(s) {
  return s.length > 0 && /^[a-z]+$/.test(s);
}

/** @param {string} a @param {string} b */
function matchesDigitSuffixVariant(a, b) {
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter === longer) return false;
  if (shorter.length < 4) return false;
  if (!isLettersOnlyCanonical(shorter)) return false;
  if (!longer.startsWith(shorter)) return false;
  const suffix = longer.slice(shorter.length);
  return suffix.length > 0 && /^\d+$/.test(suffix);
}

/** @param {string} a @param {string} b */
function matchesPrefixExtensionVariant(a, b) {
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter === longer) return false;
  if (shorter.length < 5) return false;
  if (!isLettersOnlyCanonical(shorter)) return false;
  if (!longer.startsWith(shorter)) return false;
  const suffix = longer.slice(shorter.length);
  if (suffix.length < 2 || suffix.length > 14) return false;
  if (!/^[a-z0-9]+$/.test(suffix)) return false;
  return /\d/.test(suffix);
}

/** @param {string} a @param {string} b */
function matchesEmbeddedSuffixVariant(a, b) {
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter === longer) return false;
  if (shorter.length < 5) return false;
  if (!isLettersOnlyCanonical(shorter)) return false;
  if (!longer.endsWith(shorter)) return false;
  const prefix = longer.slice(0, longer.length - shorter.length);
  if (prefix.length === 0 || prefix.length > 8) return false;
  return /^[a-z0-9]+$/.test(prefix);
}

/** @param {string} a @param {string} b */
function matchesLevenshteinTypo(a, b) {
  if (Math.min(a.length, b.length) < 4) return false;
  if (Math.abs(a.length - b.length) > 1) return false;
  if (!isLettersOnlyCanonical(a) || !isLettersOnlyCanonical(b)) return false;
  if (a[0] !== b[0]) return false;
  return levenshtein(a, b) <= 1;
}

/** @param {string} a @param {string} b */
function matchStrength(a, b) {
  if (!a || !b) return null;
  if (a === b) return { tier: 0, tieBreak: 0 };
  if (matchesDigitSuffixVariant(a, b)) {
    const shorter = a.length <= b.length ? a : b;
    const longer = a.length <= b.length ? b : a;
    return { tier: 1, tieBreak: longer.length - shorter.length };
  }
  if (matchesPrefixExtensionVariant(a, b)) {
    const shorter = a.length <= b.length ? a : b;
    const longer = a.length <= b.length ? b : a;
    return { tier: 2, tieBreak: longer.length - shorter.length };
  }
  if (matchesEmbeddedSuffixVariant(a, b)) {
    const shorter = a.length <= b.length ? a : b;
    const longer = a.length <= b.length ? b : a;
    return { tier: 3, tieBreak: longer.length - shorter.length };
  }
  if (matchesLevenshteinTypo(a, b)) {
    return { tier: 4, tieBreak: levenshtein(a, b) };
  }
  return null;
}

/** @param {string} aRaw @param {string} bRaw */
export function ignMatchesForQueueIdentity(aRaw, bRaw) {
  const a = canonicalIgnKey(aRaw);
  const b = canonicalIgnKey(bRaw);
  return matchStrength(a, b) != null;
}

/** @param {string} aRaw @param {string} bRaw */
export function ignMatchesForQueueDedupe(aRaw, bRaw) {
  const a = canonicalIgnKey(aRaw);
  const b = canonicalIgnKey(bRaw);
  if (!a || !b) return false;
  if (a === b) return true;
  if (matchesDigitSuffixVariant(a, b)) return true;
  if (matchesPrefixExtensionVariant(a, b)) return true;
  return matchesEmbeddedSuffixVariant(a, b);
}

/** @param {string} targetRaw @param {Iterable<string>} candidates */
export function findMatchingIgnName(targetRaw, candidates) {
  const target = canonicalIgnKey(targetRaw);
  if (!target) return null;

  let bestName = null;
  let bestTier = Infinity;
  let bestTie = Infinity;

  for (const c of candidates) {
    const cand = canonicalIgnKey(c);
    const strength = matchStrength(target, cand);
    if (!strength) continue;
    const { tier, tieBreak } = strength;
    if (tier < bestTier || (tier === bestTier && tieBreak < bestTie)) {
      bestTier = tier;
      bestTie = tieBreak;
      bestName = c;
    }
  }
  return bestName;
}

/** @param {{ interestedMemberIds: number[] }} item @param {{ id: number, name: string }[]} members @param {string} ignRaw */
export function queueItemHasMatchingIgn(item, members, ignRaw) {
  return matchingIgnOnQueueItem(item, members, ignRaw) != null;
}

/** @param {{ interestedMemberIds: number[] }} item @param {{ id: number, name: string }[]} members @param {string} ignRaw */
export function matchingIgnOnQueueItem(item, members, ignRaw) {
  const names = [];
  for (const mid of item.interestedMemberIds) {
    const n = members.find((m) => m.id === mid)?.name;
    if (n != null && String(n).trim()) names.push(n);
  }
  return findMatchingIgnName(ignRaw, names);
}

/** @param {{ id: number, name: string }[]} members @param {string} ignRaw */
export function findMemberByIgnIdentity(members, ignRaw) {
  const matchName = findMatchingIgnName(
    ignRaw,
    members.map((m) => m.name)
  );
  if (!matchName) return undefined;
  return members.find((m) => ignMatchesForQueueIdentity(m.name, matchName));
}
