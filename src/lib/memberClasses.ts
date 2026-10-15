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

/**
 * Character art in `public/images/class/`. Classes without art yet are left
 * out — callers fall back to a placeholder.
 */
const CLASS_IMAGES: Partial<Record<MemberClass, string>> = {
  'Lord Knight': '/images/class/lordknight.webp',
  Paladin: '/images/class/paladin.webp',
  Assassin: '/images/class/assassin.webp',
  Champion: '/images/class/champion.webp',
  Stalker: '/images/class/stalker.webp',
  Sniper: '/images/class/sniper.webp',
  'Bard / Gypsy': '/images/class/bard.webp',
  Priest: '/images/class/priest.webp',
  'High Wizard': '/images/class/highwizard.webp',
  Professor: '/images/class/professor.webp',
  Mastersmith: '/images/class/mastersmith.webp',
  Biochemist: '/images/class/biochemist.webp',
  Doram: '/images/class/doram.webp',
  Gunslinger: '/images/class/gunslinger.webp',
};

export function memberClassImage(c: MemberClass | null | undefined): string | null {
  return (c && CLASS_IMAGES[c]) || null;
}
