/** Job classes a member can pick. Keep in sync with `server/src/memberClasses.js`. */
export const MEMBER_CLASSES = [
  'Lord Knight',
  'Paladin',
  'Assassin',
  'Champion',
  'Stalker',
  'Sniper',
  'Bard / Gypsy',
  'Priest',
  'High Wizard',
  'Professor',
  'Mastersmith',
  'Biochemist',
  'Doram',
  'Gunslinger',
] as const;

export type MemberClass = (typeof MEMBER_CLASSES)[number];

export function parseMemberClass(raw: unknown): MemberClass | null {
  return typeof raw === 'string' && (MEMBER_CLASSES as readonly string[]).includes(raw)
    ? (raw as MemberClass)
    : null;
}
