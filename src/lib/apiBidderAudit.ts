import { apiUrl } from './apiState';

export type BidderAuditAction =
  | 'approve'
  | 'reject'
  | 'create'
  | 'edit'
  | 'delete'
  | 'shuffle_start'
  | 'shuffle_reset'
  | 'event_mode_change'
  | 'winner_limits_set'
  | 'clear_all_queues'
  | 'queue_remove';

export interface BidderAuditChange {
  field: string;
  from: string;
  to: string;
}

export interface BidderAuditEntry {
  id: number;
  at: number;
  action: BidderAuditAction;
  targetMemberId: number | null;
  targetName: string;
  targetRole: string | null;
  actorId: number;
  actorName: string;
  actorRole: string;
  details: {
    approvalStatus?: string;
    role?: string;
    from?: string;
    to?: string;
    eventMode?: string;
    entriesCleared?: number;
    itemId?: string;
    itemName?: string;
    itemType?: string;
    changes?: BidderAuditChange[];
  } | null;
}

const VALID_ACTIONS = new Set<string>([
  'approve',
  'reject',
  'create',
  'edit',
  'delete',
  'shuffle_start',
  'shuffle_reset',
  'event_mode_change',
  'winner_limits_set',
  'clear_all_queues',
  'queue_remove',
]);

const cred: RequestInit = { credentials: 'include' };

function parseEntry(raw: unknown): BidderAuditEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'number' ? r.id : NaN;
  const at = typeof r.at === 'number' ? r.at : NaN;
  const action = r.action;
  if (
    !Number.isInteger(id) ||
    id <= 0 ||
    !Number.isFinite(at) ||
    typeof action !== 'string' ||
    !VALID_ACTIONS.has(action)
  ) {
    return null;
  }
  let details: BidderAuditEntry['details'] = null;
  if (r.details && typeof r.details === 'object') {
    const d = r.details as Record<string, unknown>;
    const changes = Array.isArray(d.changes)
      ? d.changes
          .map((c) => {
            if (!c || typeof c !== 'object') return null;
            const o = c as Record<string, unknown>;
            if (typeof o.field !== 'string') return null;
            return {
              field: o.field,
              from: typeof o.from === 'string' ? o.from : String(o.from ?? ''),
              to: typeof o.to === 'string' ? o.to : String(o.to ?? ''),
            };
          })
          .filter((x): x is BidderAuditChange => x != null)
      : undefined;
    details = {
      approvalStatus:
        typeof d.approvalStatus === 'string' ? d.approvalStatus : undefined,
      role: typeof d.role === 'string' ? d.role : undefined,
      from: typeof d.from === 'string' ? d.from : undefined,
      to: typeof d.to === 'string' ? d.to : undefined,
      eventMode: typeof d.eventMode === 'string' ? d.eventMode : undefined,
      entriesCleared:
        typeof d.entriesCleared === 'number' ? d.entriesCleared : undefined,
      itemId: typeof d.itemId === 'string' ? d.itemId : undefined,
      itemName: typeof d.itemName === 'string' ? d.itemName : undefined,
      itemType: typeof d.itemType === 'string' ? d.itemType : undefined,
      changes: changes && changes.length > 0 ? changes : undefined,
    };
    if (
      !details.approvalStatus &&
      !details.role &&
      !details.from &&
      !details.to &&
      !details.eventMode &&
      details.entriesCleared == null &&
      !details.itemId &&
      !details.itemName &&
      !details.itemType &&
      (!details.changes || details.changes.length === 0)
    ) {
      details = null;
    }
  }
  return {
    id,
    at,
    action: action as BidderAuditAction,
    targetMemberId:
      r.targetMemberId == null
        ? null
        : typeof r.targetMemberId === 'number'
          ? r.targetMemberId
          : null,
    targetName: typeof r.targetName === 'string' ? r.targetName : '',
    targetRole: typeof r.targetRole === 'string' ? r.targetRole : null,
    actorId: typeof r.actorId === 'number' ? r.actorId : 0,
    actorName: typeof r.actorName === 'string' ? r.actorName : '',
    actorRole: typeof r.actorRole === 'string' ? r.actorRole : '',
    details,
  };
}

export const BIDDER_AUDIT_CHANGED_EVENT = 'bidderAuditChanged';

export function notifyBidderAuditChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(BIDDER_AUDIT_CHANGED_EVENT));
}

export async function fetchBidderAuditLog(): Promise<BidderAuditEntry[]> {
  const res = await fetch(apiUrl('/api/bidders/audit'), cred);
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      json && typeof json === 'object' && typeof (json as { error?: string }).error === 'string'
        ? (json as { error: string }).error
        : 'Failed to load audit log';
    throw new Error(msg);
  }
  const entries = json && typeof json === 'object' ? (json as { entries?: unknown }).entries : null;
  if (!Array.isArray(entries)) return [];
  return entries.map(parseEntry).filter((e): e is BidderAuditEntry => e != null);
}

export function isBidderRegistrationAction(action: BidderAuditAction): boolean {
  return (
    action === 'approve' ||
    action === 'reject' ||
    action === 'create' ||
    action === 'edit' ||
    action === 'delete'
  );
}
