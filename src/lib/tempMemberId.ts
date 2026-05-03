/** Negative temp ids for new roster rows before first save (server assigns positive AUTO_INCREMENT). */
let seq = 0;
export function nextTempMemberId(): number {
  seq -= 1;
  return seq;
}
