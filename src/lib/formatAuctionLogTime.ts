/** Format log timestamps (server uses auction week TZ; display matches guild default). */
export function formatAuctionLogTime(
  atMs: number,
  timeZone = 'Asia/Manila'
): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(atMs));
  } catch {
    return new Date(atMs).toISOString();
  }
}
