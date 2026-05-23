/**
 * Strip redundant type tags from stored item names, e.g. "(LND)" / "(TNS)" on a
 * second line or at end of the title — `item.type` already shows the badge.
 */
const TRAILING_TYPE_IN_PARENS =
  /\s*\((?:Feathers|LND|TNS|Fragment\s+Card|Ancient\s+Item|Other)\)\s*$/i;

const LINE_ONLY_TYPE_IN_PARENS =
  /^\s*\((?:Feathers|LND|TNS|Fragment\s+Card|Ancient\s+Item|Other)\)\s*$/i;

export function displayAuctionItemName(raw: string): string {
  if (typeof raw !== 'string' || !raw.trim()) return raw;

  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  while (
    lines.length > 1 &&
    LINE_ONLY_TYPE_IN_PARENS.test(lines[lines.length - 1] ?? '')
  ) {
    lines.pop();
  }

  let s = lines.join('\n').trimEnd();
  while (TRAILING_TYPE_IN_PARENS.test(s)) {
    s = s.replace(TRAILING_TYPE_IN_PARENS, '').trimEnd();
  }
  return s;
}
