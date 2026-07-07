import { apiUrl } from './apiState';
import type { PuppetCardCdDisplay } from './puppetCardCdDisplay';
import type { WeeklyEventType } from '../types';

const cred: RequestInit = { credentials: 'include' };

export type OnCdRow = {
  id: number;
  name: string;
  label: string;
  title: string;
  expiresAt: number | null;
  mode?: WeeklyEventType;
  cardCd: PuppetCardCdDisplay;
};

export type CardCdListResponse = {
  guildLeague: OnCdRow[];
  emperium: OnCdRow[];
  fetchedAt: number;
};

export const CARD_CD_LIST_CACHE_KEY = 'card-cd-list';

export type CardCdTab = 'guildLeague' | 'emperium';

function parseDisplay(row: {
  label?: unknown;
  title?: unknown;
  expiresAt?: unknown;
}): PuppetCardCdDisplay {
  return {
    label: typeof row.label === 'string' ? row.label : '',
    title: typeof row.title === 'string' ? row.title : '',
    tone: 'cd',
  };
}

function parseRows(rawRows: unknown, mode?: WeeklyEventType): OnCdRow[] {
  const rows: OnCdRow[] = [];
  if (!Array.isArray(rawRows)) return rows;
  for (const raw of rawRows) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const id =
      typeof r.id === 'number'
        ? r.id
        : typeof r.id === 'string' && /^\d+$/.test(r.id)
          ? parseInt(r.id, 10)
          : NaN;
    const name = typeof r.name === 'string' ? r.name.trim() : '';
    if (!Number.isInteger(id) || id <= 0 || !name) continue;
    const display = parseDisplay(r);
    rows.push({
      id,
      name,
      label: display.label,
      title: display.title,
      expiresAt:
        typeof r.expiresAt === 'number' && Number.isFinite(r.expiresAt)
          ? r.expiresAt
          : null,
      mode,
      cardCd: display,
    });
  }
  return rows;
}

export async function fetchCardCdList(): Promise<CardCdListResponse> {
  const res = await fetch(apiUrl('/api/card-cd'), cred);
  const text = await res.text().catch(() => '');
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error('Invalid JSON from server');
  }
  if (!res.ok) {
    const msg =
      json && typeof json === 'object' && typeof (json as { error?: string }).error === 'string'
        ? (json as { error: string }).error
        : `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  const o = (json ?? {}) as {
    guildLeague?: unknown;
    emperium?: unknown;
    rows?: unknown;
    fetchedAt?: unknown;
  };
  const fetchedAt =
    typeof o.fetchedAt === 'number' && Number.isFinite(o.fetchedAt)
      ? o.fetchedAt
      : Date.now();

  if (Array.isArray(o.rows)) {
    return {
      guildLeague: [],
      emperium: parseRows(o.rows, 'Emperium Overrun'),
      fetchedAt,
    };
  }

  return {
    guildLeague: parseRows(o.guildLeague, 'Guild League'),
    emperium: parseRows(o.emperium, 'Emperium Overrun'),
    fetchedAt,
  };
}
