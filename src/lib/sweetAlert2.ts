/**
 * DB sync & queue feedback — npm `sweetalert2` (centered modals).
 */
import Swal from 'sweetalert2';

const darkShell = {
  background: '#020617',
  color: '#f1f5f9',
  confirmButtonColor: '#2563eb',
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** After adding a name to an auction card queue */
export function swal2QueueMemberAdded(args: {
  ign: string;
  itemName: string;
}): Promise<void> {
  const { ign, itemName } = args;
  const i = escapeHtml(ign);
  const n = escapeHtml(itemName);
  return Swal.fire({
    ...darkShell,
    icon: 'success',
    title: 'Added successfully',
    width: 'min(28rem, calc(100vw - 2rem))',
    customClass: { htmlContainer: 'swal-queue-html' },
    html: `<div style="text-align:center;margin:0;padding:0">
<p style="margin:0 0 1rem;line-height:1.55;font-size:15px;color:#e2e8f0"><strong>${i}</strong> is now in the bid queue.</p>
<div style="display:inline-block;vertical-align:top;text-align:center;max-width:100%;padding:0.75rem 1rem;border-radius:0.75rem;background:#0f172a;border:1px solid #334155">
<div style="font-size:10px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;color:#94a3b8;margin-bottom:0.35rem">Item</div>
<div style="font-size:15px;font-weight:700;color:#f8fafc;line-height:1.35;word-break:break-word">${n}</div>
</div>
</div>`,
    confirmButtonText: 'OK',
  }).then(() => undefined);
}

/** Character is already in another active item’s queue (one bid card per name). */
export function swal2QueueAlreadyOnAnotherItem(args: {
  ign: string;
  otherItemName: string;
}): Promise<void> {
  const { ign, otherItemName } = args;
  const i = escapeHtml(ign);
  const o = escapeHtml(otherItemName);
  return Swal.fire({
    ...darkShell,
    icon: 'error',
    title: 'Already bidding on another item',
    width: 'min(28rem, calc(100vw - 2rem))',
    customClass: { htmlContainer: 'swal-queue-html' },
    html: `<div style="text-align:center;margin:0;padding:0">
<p style="margin:0 0 1rem;line-height:1.55;font-size:15px;color:#e2e8f0">Each character can only join <strong>one</strong> active bid queue at a time.</p>
<p style="margin:0 0 1rem;line-height:1.55;font-size:15px;color:#e2e8f0"><strong>${i}</strong> is already listed for:</p>
<div style="display:inline-block;vertical-align:top;text-align:center;max-width:100%;padding:0.75rem 1rem;border-radius:0.75rem;background:#0f172a;border:1px solid #334155">
<div style="font-size:10px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;color:#94a3b8;margin-bottom:0.35rem">Current item</div>
<div style="font-size:15px;font-weight:700;color:#f8fafc;line-height:1.35;word-break:break-word">${o}</div>
</div>
</div>`,
    confirmButtonText: 'OK',
  }).then(() => undefined);
}

/** Naabot na ang max na maaaring i-green-check (VITE_AUCTION_WINNER_POOL_*). */
export function swal2WinnerPoolFull(args: {
  itemType: string;
  pool: number;
}): Promise<void> {
  const t = escapeHtml(args.itemType);
  const p = String(args.pool);
  return Swal.fire({
    ...darkShell,
    icon: 'warning',
    title: 'Puno na ang winner slots',
    width: 'min(28rem, calc(100vw - 2rem))',
    html: `<p style="margin:0;line-height:1.55;font-size:15px;color:#e2e8f0;text-align:center">Para sa <strong>${t}</strong>, hanggang <strong>${p}</strong> lang ang puwedeng i-check na panalo ngayong round (ayon sa <code style="font-size:12px">.env</code> <code style="font-size:12px">VITE_AUCTION_WINNER_POOL_*</code>). Mag-reset ng shuffle kung bagong round.</p>`,
    confirmButtonText: 'OK',
  }).then(() => undefined);
}

/** Weekly type lock: IGN already recorded as winner for this type (admin green check). */
export function swal2AlreadyWonTypeThisWeek(args: {
  ign: string;
  itemName: string;
}): Promise<void> {
  const { ign, itemName } = args;
  const i = escapeHtml(ign);
  const n = escapeHtml(itemName);
  return Swal.fire({
    ...darkShell,
    icon: 'info',
    title: 'Already a winner for this type',
    width: 'min(28rem, calc(100vw - 2rem))',
    customClass: { htmlContainer: 'swal-queue-html' },
    html: `<div style="text-align:center;margin:0;padding:0">
<p style="margin:0 0 1rem;line-height:1.55;font-size:15px;color:#e2e8f0">Only <strong>winners</strong> are blocked from bidding again on the same item type (LND, TNS, …) this week — after the admin clicks the <strong>green check</strong>. Anyone <strong>not</strong> checked can still bid.</p>
<p style="margin:0;line-height:1.55;font-size:15px;color:#e2e8f0"><strong>${i}</strong> is recorded as a winner for:</p>
<div style="margin-top:1rem;display:inline-block;vertical-align:top;text-align:center;max-width:100%;padding:0.75rem 1rem;border-radius:0.75rem;background:#0f172a;border:1px solid #334155">
<div style="font-size:10px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;color:#94a3b8;margin-bottom:0.35rem">Item</div>
<div style="font-size:15px;font-weight:700;color:#f8fafc;line-height:1.35;word-break:break-word">${n}</div>
</div>
<p style="margin:1rem 0 0;line-height:1.5;font-size:13px;color:#94a3b8">This limit resets every Monday.</p>
</div>`,
    confirmButtonText: 'OK',
  }).then(() => undefined);
}

/** Same character already listed on this card */
export function swal2QueueAlreadyListed(args: {
  ign: string;
  itemName: string;
}): Promise<void> {
  const { ign, itemName } = args;
  const i = escapeHtml(ign);
  const n = escapeHtml(itemName);
  return Swal.fire({
    ...darkShell,
    icon: 'info',
    title: 'Already in this queue',
    width: 'min(28rem, calc(100vw - 2rem))',
    customClass: { htmlContainer: 'swal-queue-html' },
    html: `<div style="text-align:center;margin:0;padding:0">
<p style="margin:0 0 1rem;line-height:1.55;font-size:15px;color:#e2e8f0"><strong>${i}</strong> is already on the list for this item.</p>
<div style="display:inline-block;vertical-align:top;text-align:center;max-width:100%;padding:0.75rem 1rem;border-radius:0.75rem;background:#0f172a;border:1px solid #334155">
<div style="font-size:10px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;color:#94a3b8;margin-bottom:0.35rem">Item</div>
<div style="font-size:15px;font-weight:700;color:#f8fafc;line-height:1.35;word-break:break-word">${n}</div>
</div>
</div>`,
    confirmButtonText: 'OK',
  }).then(() => undefined);
}

/** After editing a roster / queue character name */
export function swal2MemberNameUpdated(args: {
  previousName: string;
  newName: string;
}): Promise<void> {
  const a = escapeHtml(args.previousName);
  const b = escapeHtml(args.newName);
  return Swal.fire({
    ...darkShell,
    icon: 'success',
    title: 'Name updated',
    width: 'min(28rem, calc(100vw - 2rem))',
    customClass: { htmlContainer: 'swal-queue-html' },
    html: `<div style="text-align:center;margin:0;padding:0">
<p style="margin:0 0 1rem;line-height:1.55;font-size:15px;color:#e2e8f0">Character IGN was saved. All queues now show the new name.</p>
<div style="display:inline-block;text-align:left;max-width:100%;padding:0.75rem 1rem;border-radius:0.75rem;background:#0f172a;border:1px solid #334155;width:100%;box-sizing:border-box">
<div style="font-size:10px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;color:#94a3b8;margin-bottom:0.35rem">Before</div>
<div style="font-size:14px;font-weight:600;color:#94a3b8;margin-bottom:0.75rem;word-break:break-word">${a}</div>
<div style="font-size:10px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;color:#94a3b8;margin-bottom:0.35rem">After</div>
<div style="font-size:15px;font-weight:700;color:#f8fafc;word-break:break-word">${b}</div>
</div>
</div>`,
    confirmButtonText: 'OK',
  }).then(() => undefined);
}

/** Another roster entry already uses this IGN */
export function swal2NameAlreadyTaken(): Promise<void> {
  return Swal.fire({
    ...darkShell,
    icon: 'error',
    title: 'Name already in use',
    text: 'That IGN is already taken by another character. Pick a different spelling or remove the duplicate roster entry first.',
    confirmButtonText: 'OK',
  }).then(() => undefined);
}

/** Confirm removing a bidder from the roster (soft-delete on server). */
export function swal2ConfirmRemoveMember(ign: string): Promise<boolean> {
  const i = escapeHtml(ign);
  return Swal.fire({
    ...darkShell,
    icon: 'warning',
    title: 'Remove this bidder?',
    width: 'min(28rem, calc(100vw - 2rem))',
    customClass: { htmlContainer: 'swal-queue-html' },
    html: `<p style="margin:0;line-height:1.55;font-size:15px;color:#e2e8f0;text-align:center">They will be removed from <strong>all</strong> queues and marked inactive in the database. This cannot be undone from the UI.</p>
<p style="margin:1rem 0 0;line-height:1.5;font-size:15px;color:#f8fafc;text-align:center;font-weight:700;word-break:break-word">${i}</p>`,
    showCancelButton: true,
    confirmButtonText: 'Remove',
    cancelButtonText: 'Cancel',
    confirmButtonColor: '#dc2626',
  }).then((r) => Boolean(r.isConfirmed));
}

/** Clear every active auction card’s queue — roster entries stay; people can list again. */
export function swal2ConfirmClearAllQueues(
  totalQueueEntries: number,
  cardsWithBidders: number
): Promise<boolean> {
  return Swal.fire({
    ...darkShell,
    icon: 'warning',
    title: 'Clear all lists?',
    width: 'min(28rem, calc(100vw - 2rem))',
    customClass: { htmlContainer: 'swal-queue-html' },
    html: `<p style="margin:0;line-height:1.55;font-size:15px;color:#e2e8f0;text-align:center">Remove <strong>${totalQueueEntries}</strong> queue spot${totalQueueEntries === 1 ? '' : 's'} across <strong>${cardsWithBidders}</strong> active card${cardsWithBidders === 1 ? '' : 's'}. Names stay in the guild roster — anyone can join again for the next round.</p>`,
    showCancelButton: true,
    confirmButtonText: 'Clear all lists',
    cancelButtonText: 'Cancel',
    confirmButtonColor: '#dc2626',
  }).then((r) => Boolean(r.isConfirmed));
}

/** Confirm reset: alphabetical queues + clear all winner marks (reopen cards). */
export function swal2ConfirmResetShuffleUnmark(): Promise<boolean> {
  return Swal.fire({
    ...darkShell,
    icon: 'warning',
    title: 'Reset shuffle & unmark all?',
    width: 'min(28rem, calc(100vw - 2rem))',
    text: 'Every queue will be sorted A–Z by IGN. All completed auctions go back to active with no winner. Green winner checkmarks stay hidden until you shuffle again — this also unlocks shuffle (one shuffle per round until the next reset).',
    showCancelButton: true,
    confirmButtonText: 'Reset all',
    cancelButtonText: 'Cancel',
    confirmButtonColor: '#dc2626',
  }).then((r) => Boolean(r.isConfirmed));
}

/** Confirm before shuffling all active queues. */
export function swal2ConfirmShuffleAllQueues(args: {
  totalParticipants: number;
  fragmentParticipants: number;
  lndParticipants: number;
  tnsParticipants: number;
  fragmentLimit: number;
  lndLimit: number;
  tnsLimit: number;
}): Promise<boolean> {
  const {
    totalParticipants,
    fragmentParticipants,
    lndParticipants,
    tnsParticipants,
    fragmentLimit,
    lndLimit,
    tnsLimit,
  } = args;
  return Swal.fire({
    ...darkShell,
    icon: 'question',
    title: 'Shuffle all queues?',
    width: 'min(28rem, calc(100vw - 2rem))',
    customClass: { htmlContainer: 'swal-queue-html' },
    html: `<div style="text-align:center;margin:0;padding:0">
<p style="margin:0 0 1rem;line-height:1.55;font-size:15px;color:#e2e8f0">This randomizes every active queue for this round and locks shuffle until reset.</p>
<div style="display:inline-block;text-align:left;max-width:100%;padding:0.75rem 1rem;border-radius:0.75rem;background:#0f172a;border:1px solid #334155;width:100%;box-sizing:border-box;margin-bottom:0.75rem">
<div style="font-size:10px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;color:#94a3b8;margin-bottom:0.5rem">Bidder breakdown</div>
<div style="display:flex;justify-content:space-between;gap:1rem;font-size:14px;color:#f8fafc;margin-bottom:0.35rem"><span>Puppet Frag Card</span><strong>${fragmentParticipants}</strong></div>
<div style="display:flex;justify-content:space-between;gap:1rem;font-size:14px;color:#f8fafc;margin-bottom:0.35rem"><span>LND</span><strong>${lndParticipants}</strong></div>
<div style="display:flex;justify-content:space-between;gap:1rem;font-size:14px;color:#f8fafc;margin-bottom:0.35rem"><span>TNS</span><strong>${tnsParticipants}</strong></div>
<div style="height:1px;background:#334155;margin:0.5rem 0"></div>
<div style="display:flex;justify-content:space-between;gap:1rem;font-size:14px;color:#f8fafc"><span>Total bidders</span><strong>${totalParticipants}</strong></div>
</div>
<div style="display:inline-block;text-align:left;max-width:100%;padding:0.75rem 1rem;border-radius:0.75rem;background:#0f172a;border:1px solid #334155;width:100%;box-sizing:border-box">
<div style="font-size:10px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;color:#94a3b8;margin-bottom:0.5rem">Winner set limit</div>
<div style="display:flex;justify-content:space-between;gap:1rem;font-size:14px;color:#f8fafc;margin-bottom:0.35rem"><span>Puppet Frag Card</span><strong>${fragmentLimit}</strong></div>
<div style="display:flex;justify-content:space-between;gap:1rem;font-size:14px;color:#f8fafc;margin-bottom:0.35rem"><span>LND</span><strong>${lndLimit}</strong></div>
<div style="display:flex;justify-content:space-between;gap:1rem;font-size:14px;color:#f8fafc"><span>TNS</span><strong>${tnsLimit}</strong></div>
</div>
</div>`,
    showCancelButton: true,
    confirmButtonText: 'Start Shuffle',
    cancelButtonText: 'Cancel',
    confirmButtonColor: '#2563eb',
  }).then((r) => Boolean(r.isConfirmed));
}

function formatSaveErrorMessage(raw: string): string {
  const s = raw.trim();
  if (s.startsWith('{')) {
    try {
      const j = JSON.parse(s) as { error?: string };
      if (typeof j.error === 'string' && j.error) return j.error;
    } catch {
      /* use raw */
    }
  }
  return raw;
}

/** SweetAlert2 centered modal — save failed */
export function swal2SaveError(message: string): Promise<void> {
  return Swal.fire({
    ...darkShell,
    icon: 'error',
    title: 'Could not save',
    text: formatSaveErrorMessage(message),
    confirmButtonText: 'OK',
  }).then(() => undefined);
}

/** After updating winner limits in admin modal. */
export function swal2WinnerLimitsUpdated(args: {
  fragment: number;
  lnd: number;
  tns: number;
}): Promise<void> {
  const f = String(args.fragment);
  const l = String(args.lnd);
  const t = String(args.tns);
  return Swal.fire({
    ...darkShell,
    icon: 'success',
    title: 'Winner limits saved',
    width: 'min(28rem, calc(100vw - 2rem))',
    customClass: { htmlContainer: 'swal-queue-html' },
    html: `<div style="text-align:center;margin:0;padding:0">
<p style="margin:0 0 1rem;line-height:1.55;font-size:15px;color:#e2e8f0">Updated draw winner limits for this round.</p>
<div style="display:inline-block;text-align:left;max-width:100%;padding:0.75rem 1rem;border-radius:0.75rem;background:#0f172a;border:1px solid #334155;width:100%;box-sizing:border-box">
<div style="display:flex;justify-content:space-between;gap:1rem;font-size:14px;color:#f8fafc;margin-bottom:0.35rem"><span>Puppet Frag Card</span><strong>${f}</strong></div>
<div style="display:flex;justify-content:space-between;gap:1rem;font-size:14px;color:#f8fafc;margin-bottom:0.35rem"><span>LND</span><strong>${l}</strong></div>
<div style="display:flex;justify-content:space-between;gap:1rem;font-size:14px;color:#f8fafc"><span>TNS</span><strong>${t}</strong></div>
</div>
</div>`,
    confirmButtonText: 'OK',
  }).then(() => undefined);
}
