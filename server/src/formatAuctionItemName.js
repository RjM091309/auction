const TRAILING_TYPE_IN_PARENS =
  /\s*\((?:Feathers|LND|TNS|Fragment\s+Card|Ancient\s+Item|Other)\)\s*$/i;

const LINE_ONLY_TYPE_IN_PARENS =
  /^\s*\((?:Feathers|LND|TNS|Fragment\s+Card|Ancient\s+Item|Other)\)\s*$/i;

/** @param {string} raw */
export function displayAuctionItemName(raw) {
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
