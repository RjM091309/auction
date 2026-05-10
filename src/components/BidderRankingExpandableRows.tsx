/**
 * Ranking tab: per-IGN totals + expandable breakdown by calendar day (auction TZ).
 */

import { ChevronDown } from 'lucide-react';
import type { BidderStateLogEntry } from '../types';
import { displayAuctionItemName } from '../lib/formatAuctionItemName';
import { formatInstantInAuctionWeekTz } from '../lib/auctionWeek';
import {
  BIDDER_STATE_ONGOING,
  BIDDER_STATE_WIN,
  type BidderDayOutcomeGroup,
  type BidderSummaryRow,
  bidderStateLabel,
} from '../lib/bidderStateLogUi';

function OutcomeLine({ row }: { row: BidderStateLogEntry }) {
  const { timeHm } = formatInstantInAuctionWeekTz(row.at);
  const outcome = bidderStateLabel(row.state);
  const outcomeClass =
    row.state === BIDDER_STATE_WIN
      ? 'text-green-400'
      : row.state === BIDDER_STATE_ONGOING
        ? 'text-blue-300'
        : 'text-rose-300';

  return (
    <li className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-slate-800/80 bg-slate-950/50 px-2.5 py-2 sm:flex-row sm:flex-wrap sm:items-baseline sm:justify-between sm:gap-x-3">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-slate-500">{timeHm}</span>
        <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">
          {row.itemType}
        </span>
        <span className="min-w-0 break-words text-xs font-semibold text-slate-200">
          {displayAuctionItemName(row.itemName)}
        </span>
      </div>
      <span className={`shrink-0 text-[10px] font-black uppercase tracking-wide ${outcomeClass}`}>
        {outcome}
      </span>
    </li>
  );
}

export function BidderRankingExpandableRows({
  rows,
  dayDetailsByIgn,
}: {
  rows: BidderSummaryRow[];
  dayDetailsByIgn: Map<string, BidderDayOutcomeGroup[]>;
}) {
  return (
    <ul className="space-y-2" aria-label="Win and loss counts by bidder">
      {rows.map((row) => {
        const key = row.ign.trim().toLowerCase();
        const dayGroups = dayDetailsByIgn.get(key) ?? [];

        return (
          <li
            key={key}
            className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900"
          >
            <details className="group">
              <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-5 sm:py-3.5 [&::-webkit-details-marker]:hidden">
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <ChevronDown
                    className="h-4 w-4 shrink-0 text-slate-500 transition-transform group-open:rotate-180"
                    aria-hidden
                  />
                  <span className="min-w-0 break-words font-bold text-amber-400">{row.ign}</span>
                </span>
                <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 text-xs sm:text-sm">
                  <span className="inline-flex items-baseline gap-1.5 font-mono tabular-nums text-green-400">
                    <span className="text-[9px] font-black uppercase tracking-wide text-slate-500 sm:text-[10px]">
                      Win
                    </span>
                    {row.wins}
                  </span>
                  <span className="inline-flex items-baseline gap-1.5 font-mono tabular-nums text-rose-300">
                    <span className="text-[9px] font-black uppercase tracking-wide text-slate-500 sm:text-[10px]">
                      Loss
                    </span>
                    {row.losses}
                  </span>
                  <span className="inline-flex items-baseline gap-1.5 font-mono tabular-nums text-blue-300">
                    <span className="text-[9px] font-black uppercase tracking-wide text-slate-500 sm:text-[10px]">
                      Ong
                    </span>
                    {row.ongoing}
                  </span>
                </div>
              </summary>
              <div className="border-t border-slate-800/90 px-3 pb-3 pt-1 sm:px-4">
                {dayGroups.length === 0 ? (
                  <p className="px-1 py-2 text-xs text-slate-500">
                    No logged shuffle / outcome rows for this IGN yet (they appear here from{' '}
                    <strong className="text-slate-400">bidder_state_log</strong>).
                  </p>
                ) : (
                  <div className="space-y-3 pt-2">
                    {dayGroups.map((g) => (
                      <div key={g.dateKey} className="space-y-1.5">
                        <p className="px-1 text-[11px] font-black uppercase tracking-wide text-slate-500">
                          {g.weekdayShort} · {g.dateKey}
                        </p>
                        <ul className="space-y-1.5">
                          {g.entries.map((e, i) => (
                            <OutcomeLine
                              key={
                                e.id ??
                                `${e.at}-${e.itemId}-${e.ign}-${e.state}-${i}`
                              }
                              row={e}
                            />
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}
