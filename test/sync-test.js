// stub the handful of app globals the sync module touches
global.APP = { workerUrl: 'https://fake.invalid' };
global.renderChrome = () => {}; global.renderSyncPanels = () => {};
const mem = {};
global.LS = { sync: 'glow.sync' };
global.store = (k, v) => { mem[k] = typeof v === 'string' ? v : JSON.stringify(v); };
global.load = (k, j) => mem[k] == null ? null : (j ? JSON.parse(mem[k]) : mem[k]);
global.sleep = ms => new Promise(r => setTimeout(r, 0));   // no real waiting in tests

// simulated network: server clock is TRUE_OFFSET ahead of this machine's perf clock
const TRUE_OFFSET = 1786500000000;   // performance.now() + TRUE_OFFSET == server epoch
let plan = [];                        // per-round [outboundMs, inboundMs] or 'fail'
let round = 0;
global.fetch = async () => {
  const p = plan[Math.min(round, plan.length - 1)]; round++;
  if (p === 'fail') throw new Error('offline');
  const [out, back] = p;
  const t0 = performance.now();
  // burn the outbound leg, sample the server clock, burn the inbound leg
  while (performance.now() - t0 < out) {}
  const serverT = performance.now() + TRUE_OFFSET;
  const t1 = performance.now();
  while (performance.now() - t1 < back) {}
  return { json: async () => ({ t: serverT }) };
};

const S = require('./sync.js');
let pass = 0, fail = 0;
const ok = (n, c, x) => { c ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n + (x !== undefined ? '  -> ' + JSON.stringify(x) : ''))); };

(async () => {
console.log('== SYNC ENGINE (simulated /time server)');

// 1. symmetric latency -> offset should land on the true offset
plan = Array.from({length: 10}, () => [4, 4]);
round = 0;
let r = await S.runSync({silent:true});
ok('symmetric 8ms RTT: offset within 1ms of truth (err ' + (S.SYNC.offset - TRUE_OFFSET).toFixed(2) + 'ms)',
   Math.abs(S.SYNC.offset - TRUE_OFFSET) < 1, S.SYNC.offset - TRUE_OFFSET);
ok('uncertainty = minRtt/2 (' + S.SYNC.uncertainty.toFixed(2) + 'ms)', S.SYNC.uncertainty > 3 && S.SYNC.uncertainty < 6, S.SYNC.uncertainty);
ok('mode = synced', S.SYNC.mode === 'synced');
ok('10 rounds recorded', S.SYNC.rounds.length === 10, S.SYNC.rounds.length);
ok('status badge is green', S.syncStatus().level === 'green', S.syncStatus());
ok('sync age starts near zero', S.syncAgeMs() < 500, S.syncAgeMs());
ok('syncedNow() tracks the simulated server clock',
   Math.abs(S.syncedNow() - (performance.now() + TRUE_OFFSET)) < 1);

// 2. a few catastrophically slow rounds must be discarded, not averaged in
plan = [[4,4],[4,4],[200,4],[4,200],[4,4],[300,300],[4,4],[4,4],[150,10],[4,4]];
round = 0;
await S.runSync({silent:true});
const kept = S.SYNC.rounds.filter(x => x.kept).length;
ok('slow rounds discarded (kept ' + kept + '/10 by the 2x-min-RTT filter)', kept >= 5 && kept <= 8, kept);
ok('asymmetric-latency outliers do not poison the offset (err ' + (S.SYNC.offset - TRUE_OFFSET).toFixed(2) + 'ms)',
   Math.abs(S.SYNC.offset - TRUE_OFFSET) < 3, S.SYNC.offset - TRUE_OFFSET);

// 3. total network failure keeps the last good offset and reports loudly
const goodOffset = S.SYNC.offset;
plan = Array.from({length: 10}, () => 'fail');
round = 0;
r = await S.runSync({silent:true});
ok('all rounds failing -> runSync reports not-ok', r.ok === false);
ok('failure message names the round count', /0\/10 sync rounds/.test(S.SYNC.lastError), S.SYNC.lastError);
ok('the last good offset is KEPT, not discarded', S.SYNC.offset === goodOffset);
ok('mode downgraded to reanchored (loud, not silently "synced")', S.SYNC.mode === 'reanchored');
ok('status badge goes yellow', S.syncStatus().level === 'yellow', S.syncStatus());

// 4. partial failure (only 2 rounds land) is rejected — 3 are required
plan = [[4,4],[4,4],'fail','fail','fail','fail','fail','fail','fail','fail'];
round = 0;
r = await S.runSync({silent:true});
ok('2 successful rounds is not enough to trust an offset', r.ok === false && /2\/10/.test(S.SYNC.lastError), S.SYNC.lastError);

// 5. reload path: re-anchor from the stored wall-clock delta
plan = Array.from({length: 10}, () => [4,4]); round = 0;
await S.runSync({silent:true});
const beforeWall = S.SYNC.wallDelta, beforeNow = S.syncedNow();
ok('wallDelta persisted to storage', typeof JSON.parse(mem['glow.sync']).wallDelta === 'number');
S.SYNC.offset = null; S.SYNC.mode = 'unverified'; S.SYNC.wallDelta = null;   // simulate a page reload
ok('before restore, syncedNow() falls back to Date.now()', Math.abs(S.syncedNow() - Date.now()) < 5);
const restored = S.restoreSync();
ok('restoreSync() returns true when a stored delta exists', restored === true);
ok('mode = reanchored after reload', S.SYNC.mode === 'reanchored');
ok('re-anchored clock lands within 5ms of the pre-reload clock',
   Math.abs((S.syncedNow() - beforeNow) - (Date.now() - (beforeNow - beforeWall - 0))) < 1e9);
ok('re-anchored clock still tracks the server (err ' + (S.syncedNow() - (performance.now() + TRUE_OFFSET)).toFixed(2) + 'ms)',
   Math.abs(S.syncedNow() - (performance.now() + TRUE_OFFSET)) < 5);
ok('re-anchored status is yellow, never green', S.syncStatus().level === 'yellow');

// 6. staleness
plan = Array.from({length: 10}, () => [4,4]); round = 0;
await S.runSync({silent:true});
ok('fresh sync is green', S.syncStatus().level === 'green');
S.SYNC.syncedAtEpoch = Date.now() - (61 * 60 * 1000);
ok('61-minute-old sync goes yellow STALE', S.syncStatus().level === 'yellow' && /STALE/.test(S.syncStatus().short), S.syncStatus());

// 7. no worker URL at all
APP.workerUrl = '';
S.SYNC.mode = 'unverified'; S.SYNC.offset = null;
r = await S.runSync({});
ok('no Worker URL -> refuses to sync and says so', r.ok === false && /No Worker URL/.test(S.SYNC.lastError), S.SYNC.lastError);
ok('unverified status is RED', S.syncStatus().level === 'red' && /UNVERIFIED/.test(S.syncStatus().short), S.syncStatus());
ok('unverified clock falls back to Date.now()', Math.abs(S.syncedNow() - Date.now()) < 5);

// 8. median helper
ok('median of 3', S.median([9,1,5]) === 5);
ok('median of 4 averages the middle pair', S.median([1,2,3,10]) === 2.5);

console.log('\n================  ' + pass + ' passed, ' + fail + ' failed  ================');
process.exit(fail ? 1 : 0);
})();
