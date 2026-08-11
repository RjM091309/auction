/**
 * Compares `src/lib/*.ts` Guild League logic against its `server/src/*.js`
 * mirror on the same inputs, and fails (exit 1) on any mismatch.
 *
 * Why: business rules for Guild League vs Emperium Overrun are hand-duplicated
 * between the TS client and JS server (see SKILL.md "TS <-> JS mirror pairs").
 * Nothing enforces that a fix on one side lands on the other, so behavior can
 * silently drift. This script is the guard rail — run it whenever one of the
 * mirrored files below changes.
 *
 * The TS files reference `import.meta.env.*` (Vite-only), so they can't be
 * imported by plain Node/tsx. We bundle each entry with esbuild and shim
 * `import.meta.env` to `{}` (matching "no override set" in production),
 * then import the resulting bundle.
 */
import esbuild from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Force the same "no env override" defaults on both sides regardless of the
// shell's ambient environment, so results are deterministic.
delete process.env.AUCTION_WEEK_TZ;
delete process.env.VITE_BID_LIMIT_EXEMPT_ITEM_IDS;

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'guild-league-parity-'));

function bundleTs(relPath) {
  const entry = path.join(ROOT, relPath);
  const outfile = path.join(TMP_DIR, path.basename(relPath).replace(/\.ts$/, '.mjs'));
  esbuild.buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    define: { 'import.meta.env': '{}' },
    logLevel: 'silent',
  });
  return import(pathToFileURL(outfile).href);
}

function loadJs(relPath) {
  return import(pathToFileURL(path.join(ROOT, relPath)).href);
}

const ts = {
  guildLeagueWeek: await bundleTs('src/lib/guildLeagueWeek.ts'),
  guildLeagueWinCooldown: await bundleTs('src/lib/guildLeagueWinCooldown.ts'),
  queueEligibility: await bundleTs('src/lib/queueEligibility.ts'),
  weeklyTypeWins: await bundleTs('src/lib/weeklyTypeWins.ts'),
};

const js = {
  guildLeagueWeek: await loadJs('server/src/guildLeagueWeek.js'),
  guildLeagueWinCooldown: await loadJs('server/src/guildLeagueWinCooldown.js'),
  queueEligibility: await loadJs('server/src/queueEligibility.js'),
  weeklyTypeWins: await loadJs('server/src/weeklyTypeWins.js'),
};

fs.rmSync(TMP_DIR, { recursive: true, force: true });

let passCount = 0;
const failures = [];

function check(label, tsResult, jsResult) {
  const tsStr = JSON.stringify(tsResult);
  const jsStr = JSON.stringify(jsResult);
  if (tsStr === jsStr) {
    passCount++;
  } else {
    failures.push({ label, ts: tsStr, js: jsStr });
  }
}

const TZ = 'Asia/Manila';
const puppetItem = { id: 'm1', name: 'Puppet Card', type: 'Fragment Card' };
const illusionItem = { id: 'm4', name: 'Illusion Card', type: 'Fragment Card' };
const feathersItem = { id: 'm2', name: 'Feathers', type: 'Feathers' };

// 2024-01-01 is a Monday; one timestamp per weekday, mid-day to stay clear of TZ boundaries.
const days = {
  Mon: Date.parse('2024-01-01T10:00:00Z'),
  Tue: Date.parse('2024-01-02T10:00:00Z'),
  Wed: Date.parse('2024-01-03T10:00:00Z'),
  Thu: Date.parse('2024-01-04T10:00:00Z'),
  Fri: Date.parse('2024-01-05T10:00:00Z'),
  Sat: Date.parse('2024-01-06T10:00:00Z'),
  Sun: Date.parse('2024-01-07T10:00:00Z'),
};

// 1. Tue-win -> Fri-unlock date math
for (const [name, ms] of Object.entries(days)) {
  check(`getTuesdayDateKey(${name})`, ts.guildLeagueWeek.getTuesdayDateKey(ms, TZ), js.guildLeagueWeek.getTuesdayDateKey(ms, TZ));
  check(`guildLeagueWinUnlockDayKey(${name})`, ts.guildLeagueWeek.guildLeagueWinUnlockDayKey(ms, TZ), js.guildLeagueWeek.guildLeagueWinUnlockDayKey(ms, TZ));
  check(`guildLeagueWinCooldownExpiresAt(${name})`, ts.guildLeagueWeek.guildLeagueWinCooldownExpiresAt(ms, TZ), js.guildLeagueWeek.guildLeagueWinCooldownExpiresAt(ms, TZ));
  for (const [nowName, nowMs] of Object.entries(days)) {
    check(
      `isGuildLeagueWinStillOnCooldown(win=${name}, now=${nowName})`,
      ts.guildLeagueWeek.isGuildLeagueWinStillOnCooldown(ms, nowMs, TZ),
      js.guildLeagueWeek.isGuildLeagueWinStillOnCooldown(ms, nowMs, TZ)
    );
  }
}

// 2. Win-record classification + pruning
const winRecords = [
  { ign: 'alice', t: 'Fragment Card', itemId: 'm1', at: days.Tue, mode: 'Guild League' },
  { ign: 'bob', t: 'Fragment Card', itemId: 'm1', at: days.Tue },
  { ign: 'carol', t: 'Fragment Card', at: days.Tue, mode: 'Guild League' },
  { ign: 'dave', t: 'Feathers', at: days.Tue, mode: 'Guild League' },
  { ign: 'erin', t: 'Fragment Card', itemId: 'm4', at: days.Tue, mode: 'Guild League' },
  { ign: 'frank', t: 'Fragment Card', itemId: 'm1', at: days.Tue, mode: 'Emperium Overrun' },
];
for (const w of winRecords) {
  check(`isGuildLeagueCooldownWinRecord(${w.ign})`, ts.guildLeagueWinCooldown.isGuildLeagueCooldownWinRecord(w), js.guildLeagueWinCooldown.isGuildLeagueCooldownWinRecord(w));
}
for (const [nowName, nowMs] of Object.entries(days)) {
  check(`pruneExpiredGuildLeagueWins(now=${nowName})`, ts.guildLeagueWinCooldown.pruneExpiredGuildLeagueWins(winRecords, nowMs), js.guildLeagueWinCooldown.pruneExpiredGuildLeagueWins(winRecords, nowMs));
}

// 3. Mode-branching rules (this is where TS/JS most easily diverge)
const eventModes = ['Guild League', 'Emperium Overrun', undefined, 'Bogus Mode', ''];
for (const mode of eventModes) {
  check(`isGuildLeagueWinCooldownEnabled(${mode})`, ts.guildLeagueWinCooldown.isGuildLeagueWinCooldownEnabled(mode), js.guildLeagueWinCooldown.isGuildLeagueWinCooldownEnabled(mode));
  check(`defaultEventModeForQueues(${mode})`, ts.queueEligibility.defaultEventModeForQueues(mode), js.queueEligibility.defaultEventModeForQueues(mode));
  for (const locked of [true, false]) {
    check(`shuffleLockClosesPublicSignup(${locked},${mode})`, ts.queueEligibility.shuffleLockClosesPublicSignup(locked, mode), js.queueEligibility.shuffleLockClosesPublicSignup(locked, mode));
  }
  for (const item of [puppetItem, illusionItem, feathersItem]) {
    for (const ign of ['alice', 'ALICE ', 'unknown']) {
      check(
        `weeklyTypeWinBlocksQueueJoin(${mode},${item.id},${ign})`,
        ts.queueEligibility.weeklyTypeWinBlocksQueueJoin(mode, item, winRecords, ign),
        js.queueEligibility.weeklyTypeWinBlocksQueueJoin(mode, item, winRecords, ign)
      );
    }
  }
}

// 4. Pure type-classification helpers
const typeSamples = ['Fragment Card', 'Feathers', 'LND', 'TNS', 'Ancient Item', 'Other'];
for (const t of typeSamples) {
  check(`isEmperiumCenterType(${t})`, ts.queueEligibility.isEmperiumCenterType(t), js.queueEligibility.isEmperiumCenterType(t));
  check(`isFeatherType(${t})`, ts.queueEligibility.isFeatherType(t), js.queueEligibility.isFeatherType(t));
  for (const t2 of typeSamples) {
    check(`emperiumSecondQueueBlocks(${t},${t2})`, ts.queueEligibility.emperiumSecondQueueBlocks(t, t2), js.queueEligibility.emperiumSecondQueueBlocks(t, t2));
  }
}

// 5. Cross-item queue blocking
const members = [
  { id: 1, name: 'Alice' },
  { id: 2, name: 'Bob' },
];
const items = [
  { id: 'm1', status: 'active', type: 'Fragment Card', interestedMemberIds: [1] },
  { id: 'm2', status: 'active', type: 'Feathers', interestedMemberIds: [1] },
  { id: 'm4', status: 'active', type: 'Fragment Card', interestedMemberIds: [] },
];
for (const mode of eventModes) {
  for (const targetItemId of ['m1', 'm2', 'm4']) {
    const targetType = items.find((i) => i.id === targetItemId).type;
    check(
      `findOtherActiveQueueBlockingWithMatch(${mode},${targetItemId})`,
      ts.queueEligibility.findOtherActiveQueueBlockingWithMatch(mode, items, members, 'alice', targetItemId, targetType),
      js.queueEligibility.findOtherActiveQueueBlockingWithMatch(mode, items, members, 'alice', targetItemId, targetType)
    );
  }
}

// 6. IGN normalization
for (const raw of ['  Alice ', 'BOB', '', '   ', 'Ça Va']) {
  check(`normalizeIgn(${JSON.stringify(raw)})`, ts.weeklyTypeWins.normalizeIgn(raw), js.weeklyTypeWins.normalizeIgn(raw));
}

console.log(`\nGuild League TS/JS parity: ${passCount} passed, ${failures.length} failed.\n`);
for (const f of failures) {
  console.log(`✗ ${f.label}`);
  console.log(`  ts: ${f.ts}`);
  console.log(`  js: ${f.js}`);
}

process.exit(failures.length > 0 ? 1 : 0);
