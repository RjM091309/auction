/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Check, UserPlus } from 'lucide-react';
import { motion } from 'motion/react';
import type { AuctionItem, GuildMember, GuildRank } from './types';
import { maxQueueSlotsAfterShuffle } from './lib/shuffleCaps';
import { displayAuctionItemName } from './lib/formatAuctionItemName';
import { auctionItemTypeColors } from './lib/auctionItemTypeColors';
import {
  computeWinnerAssignmentLabelsFromItems,
  freeItemsFromTotalItems,
  totalItemsForTypeByRank,
  winnerSlotsFromTotalItems,
} from './lib/pageAssignment';

export function PublicQueueCard({
  item,
  members,
  rewardRank = 'Bronze',
  rewardItemCounts,
  featherPageStart,
  isShuffling = false,
  showWinnerShortlist,
  showJoinQueue,
  onRequestAddName,
}: {
  item: AuctionItem;
  members: GuildMember[];
  rewardRank?: GuildRank;
  rewardItemCounts?: { fragment: number; lnd: number; tns: number };
  featherPageStart?: number;
  /** Optional visual loading phase; hide page assignment until final result is shown. */
  isShuffling?: boolean;
  /** Same as admin: off after Reset / Unmark until Shuffle again. */
  showWinnerShortlist: boolean;
  /** Hidden after admin runs “Shuffle all queues” until Reset shuffle. */
  showJoinQueue: boolean;
  onRequestAddName: () => void;
}) {
  const shortlistSlots = showWinnerShortlist
    ? maxQueueSlotsAfterShuffle(item.type, item.winnerPoolCap)
    : 0;

  /** Same cap as admin shortlist rows after “Shuffle all queues”. */
  const winnerPickPoolSize = maxQueueSlotsAfterShuffle(
    item.type,
    item.winnerPoolCap
  );
  const counts = rewardItemCounts ?? {
    fragment: totalItemsForTypeByRank('Fragment Card', rewardRank),
    lnd: totalItemsForTypeByRank('LND', rewardRank),
    tns: totalItemsForTypeByRank('TNS', rewardRank),
  };
  const winnerPageRanges = (() => {
    const totalItems =
      item.type === 'Fragment Card'
        ? counts.fragment
        : item.type === 'LND'
          ? counts.lnd
          : item.type === 'TNS'
            ? counts.tns
            : 1;
    const pageStart =
      item.type === 'LND' || item.type === 'TNS'
        ? featherPageStart ?? 1
        : 1;
    return computeWinnerAssignmentLabelsFromItems(
      item.type,
      totalItems,
      item.interestedMemberIds.length,
      pageStart
    );
  })();
  const freeItems =
    item.type === 'LND'
      ? freeItemsFromTotalItems(item.type, counts.lnd)
      : item.type === 'TNS'
        ? freeItemsFromTotalItems(item.type, counts.tns)
        : 0;
  const freePageInfo = (() => {
    if (item.type !== 'LND' && item.type !== 'TNS') return null;
    const pageStart = featherPageStart ?? 1;
    const totalItems = item.type === 'LND' ? counts.lnd : counts.tns;
    const fullPages = winnerSlotsFromTotalItems(item.type, totalItems);
    return freeItems > 0 ? { pageLabel: `P${pageStart + fullPages}`, freeItems } : null;
  })();

  return (
    <motion.article
      layout
      className="w-full min-w-0 max-w-full self-start rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl sm:rounded-[2rem] sm:p-6 md:rounded-[2.5rem] md:p-8"
    >
      <div className="mb-5 flex flex-col gap-4 sm:mb-6 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <div className="min-w-0 flex-1">
          <span
            className={`inline-block rounded-lg border px-2.5 py-1 font-mono text-[9px] font-black uppercase tracking-[0.2em] sm:px-3 sm:text-[10px] ${auctionItemTypeColors[item.type]}`}
          >
            {item.type}
          </span>
          <h2 className="mt-3 break-words text-2xl font-black leading-tight tracking-tight text-white sm:mt-4 sm:text-3xl sm:leading-none">
            {displayAuctionItemName(item.name)}
          </h2>
        </div>
        <div
          className="flex w-full shrink-0 flex-row items-center justify-between gap-3 rounded-2xl border border-slate-600/45 bg-slate-800/50 px-4 py-3 text-left sm:w-auto sm:max-w-[9.5rem] sm:flex-col sm:items-center sm:justify-center sm:px-3 sm:py-2.5 sm:text-center md:px-3.5 md:py-3"
          title={`After shuffle, only the top ${winnerPickPoolSize} in this queue are in the winner draw (same as admin shortlist).`}
        >
          <div className="min-w-0 flex-1 sm:flex-none sm:text-center">
            <span className="block text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">
              Draw winner
            </span>
            <span className="mt-0.5 block font-mono text-2xl font-black leading-none tabular-nums text-slate-100 [text-decoration:none] sm:text-[1.65rem] md:text-3xl">
              {winnerPickPoolSize}
            </span>
          </div>
          <span className="max-w-[11rem] text-right text-[9px] font-bold leading-snug text-slate-400 [text-decoration:none] sm:max-w-[7.5rem] sm:text-center">
            {winnerPickPoolSize === 1
              ? 'Only 1 can win'
              : `Only ${winnerPickPoolSize} can win`}
            <span className="mt-0.5 block font-semibold text-slate-500 [text-decoration:none]">
              after shuffle
            </span>
            {!isShuffling && showWinnerShortlist && freeItems > 0 && (
              <span className="mt-0.5 block font-semibold text-amber-400 [text-decoration:none]">
                {freePageInfo
                  ? `+ FREE ${freePageInfo.pageLabel} (${freePageInfo.freeItems} items)`
                  : `+${freeItems} free item${freeItems === 1 ? '' : 's'}`}
              </span>
            )}
          </span>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3 sm:rounded-3xl sm:p-4">
        {item.interestedMemberIds.length === 0 ? (
          <p className="py-10 text-center text-xs font-bold text-slate-500">No bidders in this queue yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {item.interestedMemberIds.map((mid, idx) => {
              const m = members.find((x) => x.id === mid);
              if (!m) return null;
              const shortlist = idx < shortlistSlots;
              const pageLabel =
                !isShuffling && shortlist && idx < winnerPageRanges.length
                  ? winnerPageRanges[idx]
                  : null;
              return (
                <li
                  key={isShuffling ? `slot-${item.id}-${idx}` : mid}
                  className={`flex items-center justify-between gap-2 rounded-2xl border px-3 py-2.5 sm:gap-3 sm:px-3 sm:py-3 ${
                    shortlist
                      ? 'border-blue-500/50 bg-blue-600/20'
                      : isShuffling
                        ? 'border-blue-400/60 bg-blue-500/15'
                        : 'border-slate-800 bg-slate-900'
                  }`}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span className="min-w-0 flex-1 break-words font-bold leading-normal text-slate-200 [overflow-wrap:anywhere]">
                      {isShuffling ? <span className="animate-pulse text-white">{m.name}</span> : m.name}
                    </span>
                    {pageLabel ? (
                      <span
                        title={
                          pageLabel.startsWith('I')
                            ? `Assigned item slot ${pageLabel.slice(1)}`
                            : `Assigned page ${pageLabel.slice(1)}`
                        }
                        className="shrink-0 rounded-lg border border-blue-500/60 bg-blue-500/15 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-blue-200"
                      >
                        {pageLabel}
                      </span>
                    ) : null}
                  </div>
                  {shortlist ? (
                    <div
                      className="pointer-events-none flex h-8 w-8 shrink-0 cursor-default select-none items-center justify-center rounded-lg bg-green-600/85 text-white shadow-sm shadow-green-950/30"
                      title="Shortlist slot after shuffle (read-only). Only an admin can mark winners in the dashboard."
                      aria-hidden
                    >
                      <Check className="h-4 w-4 stroke-[2.5]" aria-hidden />
                    </div>
                  ) : null}
                </li>
              );
            })}
            {!isShuffling && showWinnerShortlist && freeItems > 0 && (
              <li className="flex items-center justify-center rounded-2xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-[10px] font-black uppercase tracking-wide text-amber-300 sm:px-3 sm:py-3">
                {freePageInfo
                  ? `FREE: ${freePageInfo.pageLabel} (${freePageInfo.freeItems} items)`
                  : `FREE items: ${freeItems}`}
              </li>
            )}
          </ul>
        )}
      </div>

      {showJoinQueue ? (
        <div className="mt-5 sm:mt-6">
          <button
            type="button"
            onClick={onRequestAddName}
            className="inline-flex min-h-12 w-full touch-manipulation items-center justify-center gap-2 rounded-2xl border border-blue-500/40 bg-blue-600/15 py-3.5 text-sm font-black uppercase tracking-widest text-blue-200 transition-colors active:scale-[0.99] hover:border-blue-400/60 hover:bg-blue-600/25 sm:py-4"
          >
            <UserPlus className="h-5 w-5 shrink-0" aria-hidden />
            Join this queue
          </button>
        </div>
      ) : null}
    </motion.article>
  );
}
