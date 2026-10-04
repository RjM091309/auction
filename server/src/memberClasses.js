/** Job classes a member can pick (stored in `members.job_class`). Keep in sync with `src/lib/memberClasses.ts`. */
export const MEMBER_CLASSES = [
  'Lord Knight',
  'Paladin',
  'Assassin',
  'Champion',
  'Stalker',
  'Sniper',
  'Bard / Gypsy',
  'Priest',
  'Mastersmith',
  'Biochemist',
  'Doram',
  'Gunslinger',
];

const byLower = new Map(MEMBER_CLASSES.map((c) => [c.toLowerCase(), c]));

/** Canonical class name, or null for empty / unknown input. */
export function sanitizeMemberClass(raw) {
  if (typeof raw !== 'string') return null;
  return byLower.get(raw.trim().toLowerCase()) ?? null;
}
