---
name: auction
description: >-
  Guild auction bid app (ROOC): React/Vite frontend, Express/MySQL API, queue
  shuffle, winner pools, weekly cooldowns, bidder registration. Use when
  working in /var/www/landingpage/auction, editing auction queues, shuffle logic,
  cooldowns, bidders, overrun rewards, card CD, or API/state persistence.
---

# Auction Bid — Project Skill

Guild auction dashboard for weekly item bidding (Fragment Cards, Feathers, etc.).
Members join item queues; admin shuffles, marks winners, and manages cooldowns.

## Stack

| Layer | Tech | Location |
|-------|------|----------|
| Frontend | React 19, TypeScript, Vite 6, Tailwind 4 | `src/` |
| Backend | Express 4, Node ESM (`.js`) | `server/src/` |
| Database | MySQL (`mysql2`) | `server/src/db.js`, `server/sql/` |
| Process | PM2 or `concurrently` | `ecosystem.config.cjs`, `package.json` |

**Ports:** API `1010` (`PORT`), Vite dev `1011`. Vite proxies `/api` → `http://127.0.0.1:1010`.

## Dev commands

```bash
npm run dev:all      # Vite (1011) + API (1010) with watch
npm run dev          # Frontend only
npm run server:dev   # API only with --watch
npm run build        # Production frontend → dist/
npm run lint         # tsc --noEmit
pm2 start ecosystem.config.cjs   # same as dev:all under PM2
```

Before API work, confirm MySQL is up and `.env` has `MYSQL_*` set. API boot runs schema init + migrations in `db.js`.

## Routes

| Path | UI |
|------|-----|
| `/` | Queues dashboard |
| `/logs` | History (winner marks, shuffle outcomes) |
| `/bidders` | Bidder registration (admin; bearer auth) |
| `/card-cd` | Public Puppet Card CD list |
| `/registration` | Public sign-up page |

Route map: `src/lib/tabRoute.ts`. Top-level switch: `src/App.tsx`.

## Domain model (read `src/types.ts` first)

- **AuctionItem** — `id` (e.g. `m1`, `m4`), `type`, `winnerPoolCap`, queue (`interestedMemberIds`), `recordedWinnerNames` (green check), `revokedWinnerNames`, `status`.
- **GuildMember** — numeric `id`, IGN `name`, `role` (`Officer` | `Member` | `Developer` | `Admin`).
- **AuctionState** — full snapshot: items, members, flags (`winnerShortlistUiEnabled`, `shuffleLocked`), `weeklyTypeWins`, logs, `eventMode`, `rewardRank`.
- **WeeklyEventType** — `Guild League` or `Emperium Overrun`; affects cooldowns and queue rules.
- **ItemType** — `Fragment Card`, `Feathers`, `Ancient Item`, `Other`.

Default items: `src/data/auctionDefaults.ts` (`m1` Puppet, `m2` Feathers, `m4` Illusion). Bump `AUCTION_DATA_VERSION` when default rows change.

### Core flows

1. **Queue** — members join item queues (`POST /api/public/queue/add`, move via `/move`).
2. **Shuffle** — admin shuffles all queues once per round (`shuffleLocked`); shortlist UI toggled by `winnerShortlistUiEnabled`.
3. **Winner mark** — admin green-check → `winner_mark_log` + `weeklyTypeWins`; not duplicated in `bidder_state_log`.
4. **Shuffle lock log** — `bidder_state_log` records win/loss (`state`: 0=loss, 1=win) on shuffle lock only.
5. **Cooldowns** — `weeklyTypeWins` pruned by Guild League / Emperium rules (`guildLeagueWinCooldown`, `emperiumWinCooldown`).
6. **Overrun rewards** — admin config/ranking/run under `/api/admin/overrun/*`.

Pool caps: `src/lib/shuffleCaps.ts` — `maxQueueSlotsAfterShuffle(type, winnerPoolCap)`.

## Where to edit

| Task | Primary files |
|------|----------------|
| Dashboard UI | `src/AuctionDashboard.tsx` |
| Registration | `src/RegistrationPage.tsx`, `src/BidderRegistration.tsx` |
| Types / state shape | `src/types.ts` → mirror in `server/sql/init_auction_crud.sql` |
| Persist / load state | `server/src/stateRepo.js`, `src/lib/apiState.ts` |
| API routes | `server/src/index.js` |
| DB schema / migrations | `server/src/db.js`, `server/sql/init_auction_crud.sql` |
| Bidder CRUD / auth | `server/src/bidders.js`, `src/lib/apiBidders.ts` |
| Audit logs | `server/src/bidderAuditLog.js`, `server/src/winnerMarkLog.js`, `server/src/bidderStateLog.js` |
| Card CD display | `server/src/cardCdApi.js`, `src/CardCdSection.tsx`, `src/lib/puppetCardCdDisplay.ts` |
| Sure-win pin shuffle | `server/src/sureWinPin.js` + `SURE_WIN_*` env |

## TS ↔ JS mirror pairs

Business logic often exists in **both** `src/lib/*.ts` (client) and `server/src/*.js` (API). When changing rules, update **both** sides:

| Frontend (`src/lib/`) | Backend (`server/src/`) |
|-----------------------|-------------------------|
| `auctionWeek.ts` | `auctionWeek.js` |
| `overrunWeek.ts` | `overrunWeek.js` |
| `guildLeagueWeek.ts` | `guildLeagueWeek.js` |
| `guildLeagueWinCooldown.ts` | `guildLeagueWinCooldown.js` |
| `emperiumWinCooldown.ts` | `emperiumWinCooldown.js` |
| `queueEligibility.ts` | `queueEligibility.js` |
| `ignQueueIdentity.ts` | `ignQueueIdentity.js` |
| `formatAuctionItemName.ts` | `formatAuctionItemName.js` |
| `hiddenAuctionItems.ts` | `hiddenAuctionItems.js` |
| `puppetCardCdDisplay.ts` | `puppetCardCdDisplay.js` |
| `weeklyTypeWins.ts` | `weeklyTypeWins.js` |
| `bidLimitExempt.ts` | `bidLimitExempt.js` |

Server-only: `stateRepo.js`, `bidders.js`, `db.js`, `overrunRewards.js`, `winnerPoolCaps.js`.

## API surface (prefix `/api`)

Public: `GET /health`, `GET /state`, `GET /card-cd`, `POST /public/register`, `POST /public/queue/add|move`, `GET /public/registration/check`.

State admin (`requireAuth` is legacy no-op; real gate is bidder bearer on `/bidders` routes): `PUT /state`, `POST /state/event-mode`, `POST /state/winner-limits`, `POST /state/clear-queues`, `POST /shuffle/pin-queues`, queue/member deletes.

Bidders: `GET|POST|PUT|DELETE /bidders*`, `POST /bidders/auth`, `GET /bidders/audit`.

Overrun: `GET|PUT /admin/overrun/config|ranking`, `POST /admin/overrun/run`, `GET /admin/overrun/runs`.

Client API helpers: `src/lib/apiState.ts`, `src/lib/apiBidders.ts`, `src/lib/apiCardCd.ts`. Use `apiUrl()` for optional `VITE_API_ORIGIN`.

## Database

Tables: `app_meta`, `members`, `auction_items`, `item_queue`, `winner_mark_log`, `bidder_state_log`, `bidder_audit_log`, overrun tables. Schema reference: `server/sql/init_auction_crud.sql`.

New columns/tables → add migration function in `db.js` and call it from boot sequence in `index.js`. Keep SQL file in sync for manual installs.

`app_meta` keys include: `data_version`, `winner_shortlist_ui`, `shuffle_locked`, `auction_week_monday`, `weekly_type_wins` (JSON).

## Environment variables

| Variable | Purpose |
|----------|---------|
| `PORT` | API port (default 1010) |
| `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE` | DB connection |
| `SURE_WIN_ENABLED`, `SURE_WIN_ITEM_NAME` | Pin shuffle to specific item |
| `VITE_BID_LIMIT_EXEMPT_ITEM_IDS` | Comma-separated item ids exempt from bid limits |
| `VITE_API_ORIGIN` | Optional absolute API base for production |
| `VITE_PROXY_API_TARGET` | Vite dev proxy target (default `http://127.0.0.1:1010`) |

Never commit secrets. Do not paste `.env` values into code or docs.

## Conventions

1. **Minimize scope** — small, focused diffs; don't refactor unrelated code.
2. **Match existing style** — mixed EN/TL comments are normal; keep them if touching nearby code.
3. **IGN handling** — case-insensitive dedupe (`dedupeRosterMembersByIgn`, `dedupeIgnAcrossQueues`); one IGN per queue rules in `queueEligibility`.
4. **Alerts** — use `src/lib/sweetAlert2.ts` wrappers, not raw `alert()`.
5. **Auth** — `requireAuth` in `server/src/auth.js` is a no-op; bidder page uses bearer tokens from `bidders.js`.
6. **State writes** — prefer targeted API endpoints over huge `PUT /api/state` when adding features; full replace still used for dashboard sync.
7. **No git commits** unless the user explicitly asks.

## Common change checklist

**New auction item type or default item**
- [ ] `src/data/auctionDefaults.ts` + bump `AUCTION_DATA_VERSION`
- [ ] `src/types.ts` if new `ItemType`
- [ ] `shuffleCaps.ts`, `auctionItemTypeColors.ts`, display order libs
- [ ] `db.js` seed/migrate if server defaults differ
- [ ] Cooldown/eligibility libs if type has special rules

**New cooldown or queue rule**
- [ ] `src/lib/queueEligibility.ts` + `server/src/queueEligibility.js`
- [ ] Cooldown module(s) on both sides
- [ ] `weeklyTypeWins` read/write in `stateRepo.js`

**New API endpoint**
- [ ] Route in `server/src/index.js`
- [ ] Client helper in `src/lib/api*.ts`
- [ ] Audit log entry if admin action (`bidderAuditLog.js`)

**Schema change**
- [ ] Migration in `db.js`
- [ ] Update `server/sql/init_auction_crud.sql`
- [ ] `getFullState` / `replaceFullState` in `stateRepo.js`

## Utility script

`scripts/add-names-to-cards.js` — bulk add member names to card queues (run with node when needed).

## Additional resources

- Types & state contract: [src/types.ts](../../src/types.ts)
- SQL schema: [server/sql/init_auction_crud.sql](../../server/sql/init_auction_crud.sql)
