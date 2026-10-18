#!/usr/bin/env node
// MiniSquad test runner: `npm test -- <group|suite>... [options]`. Run `npm test -- --help` for usage.
//
// Builds the game (tsc + vite), serves dist/ on a free port, builds and serves the baseline commits the BASE=
// comparisons were written against, runs the selected tools/*.cjs suites one at a time with URL / BASE / OUT set,
// and prints one line per suite. Full output of every suite is kept in test-results/<run>/<suite>.log.
// Suites are unchanged standalone scripts: `node tools/<suite>.cjs` still works against any served build.
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');
const { SUITES, GROUPS, HELPERS } = require('./test-suites.cjs');
const { parseResult, serveDir, loadPlaywright } = require('./lib.cjs');

const ROOT = path.resolve(__dirname, '..');
const RESULTS = path.join(ROOT, 'test-results');
const CACHE = path.join(ROOT, 'node_modules', '.cache', 'minisquad-tests');
const KEEP_RUNS = 10;
const TIMEOUT = { rules: 20 * 60, report: 90 * 60, screens: 10 * 60, legacy: 30 * 60 };
const EXIT = { ok: 0, failed: 1, setup: 2, error: 3, interrupted: 130 };

const HELP = `MiniSquad Test Runner

Usage: npm test -- [targets...] [options]
       node tools/test.cjs [targets...] [options]

Targets are group names or suite names (tools/<suite>.cjs), any mix. No target runs the "smoke" group.

Groups:
${Object.entries(GROUPS).map(([g, v]) => `  ${g.padEnd(12)} ${v.about}`).join('\n')}

Options:
  --list, -l          list groups and suites (with kind, baseline and setup notes) and exit
  --verbose, -v       stream every suite's full output while it runs
  --no-build          reuse the existing dist/ instead of running \`npm run build\` (tsc + vite build)
  --url <url>         test an already served build (skips build and serve)
  --base <mode>       auto (default): build and serve each suite's pinned baseline commit as BASE
                      none: run without BASE (BASE-only checks are skipped, or fail where the suite requires it)
                      <git ref>: build that commit and pass it as BASE to every suite (e.g. HEAD~1)
                      <url>: pass this already served BASE to every suite
  --repeat <n>        run each selected suite n times (flake hunting)
  --timeout <secs>    per-suite timeout (default ${TIMEOUT.rules}s rules, ${TIMEOUT.report}s reports)
  --bail              stop after the first suite that does not pass
  --screens           also give non-screenshot suites an OUT folder (they then save their phone screenshots)
  --json <file>       also write the machine-readable summary to <file>
  --help, -h          this help

Examples:
  npm test                                  smoke group
  npm test -- progression                   one group
  npm test -- logic squad-training          two suites
  npm test -- all                           full regression (slow)
  npm test -- logic --repeat 10 --no-build  hunt a flake
  QUICK=1 npm test -- squad-training        suite env vars pass straight through

Statuses: PASS (all checks passed)  FAIL (a check failed)  ERROR (crash, timeout, no checks, setup problem)
          DONE (report / screenshot script exited 0; nothing asserted)
Exit code: 0 all passed, 1 a check failed, 3 a suite errored, 2 setup or usage error, 130 interrupted.
Logs: test-results/<run>/<suite>.log (full output), summary.json, screens/<suite>/ (OUT).`;

// ---------------------------------------------------------------- arguments
function parseArgs(argv) {
  const o = { targets: [], verbose: false, build: true, url: '', base: 'auto', repeat: 1, timeout: 0, bail: false, screens: false, json: '', list: false, help: false };
  const val = (i, flag) => { if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) usage(`${flag} needs a value`); return argv[i + 1]; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--list' || a === '-l') o.list = true;
    else if (a === '--verbose' || a === '-v') o.verbose = true;
    else if (a === '--no-build') o.build = false;
    else if (a === '--bail') o.bail = true;
    else if (a === '--screens') o.screens = true;
    else if (a === '--url') { o.url = val(i, a); i++; }
    else if (a === '--base') { o.base = val(i, a); i++; }
    else if (a === '--json') { o.json = path.resolve(val(i, a)); i++; }
    else if (a === '--repeat') { o.repeat = parseInt(val(i, a), 10); i++; if (!(o.repeat >= 1)) usage('--repeat needs a number >= 1'); }
    else if (a === '--timeout') { o.timeout = parseInt(val(i, a), 10); i++; if (!(o.timeout > 0)) usage('--timeout needs seconds > 0'); }
    else if (a.startsWith('-')) usage(`unknown option ${a}`);
    else o.targets.push(a.replace(/^tools\//, '').replace(/\.cjs$/, ''));
  }
  return o;
}

function usage(msg) {
  console.error(`Error: ${msg}\nRun \`npm test -- --help\` for usage, \`npm test -- --list\` for groups and suites.`);
  process.exit(EXIT.setup);
}

function closest(name, pool) {
  const d = (a, b) => { const m = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 1; j <= b.length; j++) m[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return m[a.length][b.length]; };
  return pool.map((p) => [p, d(name, p)]).filter(([p, k]) => k <= 2 || p.includes(name) || name.includes(p)).sort((a, b) => a[1] - b[1]).slice(0, 4).map(([p]) => p);
}

function resolveTargets(targets) {
  const byName = new Map(SUITES.map((s) => [s.name, s]));
  const picked = [];
  for (const t of targets.length ? targets : ['smoke']) {
    const names = GROUPS[t] ? GROUPS[t].suites : byName.has(t) ? [t] : null;
    if (!names) {
      const file = path.join(__dirname, `${t}.cjs`);
      const hint = fs.existsSync(file) && !HELPERS.includes(`${t}.cjs`) ? ` tools/${t}.cjs exists but is not registered in tools/test-suites.cjs.` : '';
      const near = closest(t, [...Object.keys(GROUPS), ...byName.keys()]);
      usage(`unknown group or suite "${t}".${hint}${near.length ? ` Did you mean: ${near.join(', ')}?` : ''}`);
    }
    for (const n of names) if (!picked.some((s) => s.name === n)) picked.push(byName.get(n));
  }
  return picked;
}

function list() {
  console.log('Groups');
  for (const [g, v] of Object.entries(GROUPS)) console.log(`  ${g.padEnd(12)} ${v.about}\n  ${''.padEnd(12)} ${v.suites.join(', ')}`);
  console.log('\nSuites (kind, pinned BASE)');
  for (const s of SUITES) console.log(`  ${s.name.padEnd(23)} ${s.kind.padEnd(8)} ${(s.base ? s.base.label + ' ' + s.base.ref : '').padEnd(16)} ${s.about}${s.needs ? ` [${s.needs}]` : ''}`);
  const known = new Set([...SUITES.map((s) => `${s.name}.cjs`), ...HELPERS]);
  const extra = fs.readdirSync(__dirname).filter((f) => f.endsWith('.cjs') && !known.has(f));
  if (extra.length) console.log(`\nUnregistered scripts (add them to tools/test-suites.cjs): ${extra.join(', ')}`);
}

// ---------------------------------------------------------------- process / cleanup
const live = { child: null, servers: [], interrupted: false };

function killChild(sig = 'SIGTERM') {
  const c = live.child;
  if (!c || c.exitCode !== null || c.signalCode) return;
  try { process.kill(-c.pid, sig); } catch { try { c.kill(sig); } catch { /* gone */ } }
}

async function cleanup() {
  killChild('SIGKILL');
  for (const s of live.servers.splice(0)) await s.close().catch(() => {});
}

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, async () => {
    if (live.interrupted) process.exit(EXIT.interrupted);
    live.interrupted = true;
    console.error(`\n${sig}: stopping the running suite and the servers this run started...`);
    await cleanup();
    process.exit(EXIT.interrupted);
  });
}

function sh(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { out += d; });
    c.on('error', (e) => resolve({ code: -1, out: out + String(e) }));
    c.on('close', (code) => resolve({ code, out }));
  });
}

// ---------------------------------------------------------------- setup
async function setupFail(what, detail) {
  console.log(`\nSETUP ERROR: ${what}`);
  if (detail) console.log(detail.trim().split('\n').slice(-25).map((l) => `  ${l}`).join('\n'));
  await cleanup();
  process.exit(EXIT.setup);
}

async function checkBrowser() {
  let pw;
  try { pw = loadPlaywright(); } catch (e) { return setupFail(e.message, 'The suites drive headless Chromium through Playwright.'); }
  try { const b = await pw.chromium.launch(); await b.close(); } catch (e) { return setupFail('headless Chromium does not start', String(e.message || e)); }
}

/** Builds commit `ref` into the cache (once) and returns its dist folder. */
async function baseDist(ref) {
  let sha;
  try { sha = execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: ROOT }).toString().trim(); } catch { return { error: `baseline commit ${ref} is not in this checkout (shallow clone? try \`git fetch --unshallow\`, or run with --base none)` }; }
  const dir = path.join(CACHE, `base-${sha.slice(0, 12)}`), dist = path.join(dir, 'dist');
  if (fs.existsSync(path.join(dist, 'index.html'))) return { dist };
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const tar = await sh('sh', ['-c', `git archive ${sha} | tar -x -C "${dir}"`]);
  if (tar.code !== 0) return { error: `could not extract ${ref}: ${tar.out.trim().slice(-300)}` };
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  const vite = await sh(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--logLevel', 'error'], { cwd: dir });
  if (vite.code !== 0 || !fs.existsSync(path.join(dist, 'index.html'))) { fs.rmSync(dir, { recursive: true, force: true }); return { error: `vite build of baseline ${ref} failed: ${vite.out.trim().slice(-300)}` }; }
  return { dist };
}

function newRunDir() {
  fs.mkdirSync(RESULTS, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  let dir = path.join(RESULTS, stamp), n = 1;
  while (fs.existsSync(dir)) dir = path.join(RESULTS, `${stamp}-${++n}`);
  fs.mkdirSync(dir);
  const runs = fs.readdirSync(RESULTS).filter((d) => /^\d{8}-\d{6}/.test(d)).sort();
  for (const old of runs.slice(0, Math.max(0, runs.length - KEEP_RUNS))) fs.rmSync(path.join(RESULTS, old), { recursive: true, force: true });
  return dir;
}

// ---------------------------------------------------------------- running a suite
function runOne(suite, env, logFile, opts) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const log = fs.createWriteStream(logFile);
    const child = spawn(process.execPath, [path.join(__dirname, `${suite.name}.cjs`)], { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    live.child = child;
    let out = '', timedOut = false;
    const onData = (d) => { out += d; log.write(d); if (opts.verbose) process.stdout.write(d); };
    child.stdout.on('data', onData); child.stderr.on('data', onData);
    const limit = (opts.timeout || TIMEOUT[suite.kind]) * 1000;
    const timer = setTimeout(() => { timedOut = true; killChild('SIGKILL'); }, limit);
    child.on('error', (e) => { out += String(e); });
    child.on('close', (code, signal) => {
      clearTimeout(timer); live.child = null;
      // the suite's Chromium shares its process group; make sure nothing outlives it
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ }
      log.end();
      resolve(classify(suite, { code, signal, out, timedOut, secs: (Date.now() - t0) / 1000, limit }));
    });
  });
}

/** Turns exit code + output into PASS / FAIL / ERROR / DONE without trusting either alone. */
function classify(suite, r) {
  const lines = r.out.split('\n');
  const passLines = lines.filter((l) => /^PASS\s/.test(l)).length;
  const failLines = lines.filter((l) => /^FAIL\s/.test(l));
  const res = { status: 'ERROR', secs: r.secs, code: r.code, checks: null, failed: null, reason: '', failures: failLines };
  const result = parseResult(r.out);
  if (r.timedOut) return { ...res, reason: `timed out after ${Math.round(r.limit / 1000)}s` };
  if (r.signal) return { ...res, reason: `killed by ${r.signal}` };
  if (suite.kind !== 'rules') {
    if (r.code === 0) return { ...res, status: 'DONE', reason: suite.kind === 'report' ? 'report' : suite.kind };
    return { ...res, reason: `exited ${r.code}` };
  }
  if (result && result.crashed) return { ...res, reason: `crashed: ${result.crashed.replace(/\x1b\[[0-9;]*m/g, '').split('\n')[0]}` };
  // checks: the suite's own result line (lib.cjs) when it has one, else its PASS / FAIL lines (one per check by contract)
  const checks = result ? result.checks : passLines + failLines.length;
  const failed = result ? result.failed : failLines.length;
  Object.assign(res, { checks, failed });
  if (result && result.checks !== passLines + failLines.length) return { ...res, reason: `result line says ${result.checks} checks but ${passLines + failLines.length} PASS/FAIL lines were printed` };
  if (r.code === 0 && failed === 0 && checks > 0) return { ...res, status: 'PASS' };
  if (r.code === 0 && checks === 0) return { ...res, reason: 'exited 0 but ran no checks' };
  if (r.code === 0 && failed > 0) return { ...res, reason: `exited 0 but printed ${failed} FAIL line(s)` };
  if (r.code === 1 && failed > 0) return { ...res, status: 'FAIL' };
  if (r.code === 1 && result && result.errors) return { ...res, status: 'FAIL', reason: `${result.errors} page error(s)` };
  if (r.code === 1) return { ...res, reason: 'exited 1 with no FAIL line (crash or page errors before the checks finished)' };
  return { ...res, reason: `exited ${r.code}` };
}

function tail(text, n) {
  return text.trim().split('\n').filter((l) => !/^PASS\s/.test(l) && !l.startsWith('##minisquad-result')).map((l) => l.replace(/\x1b\[[0-9;]*m/g, '')).slice(-n);
}

// ---------------------------------------------------------------- main
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(HELP); return EXIT.ok; }
  if (opts.list) { list(); return EXIT.ok; }
  const suites = resolveTargets(opts.targets);
  const t0 = Date.now();
  const runDir = newRunDir();
  const label = opts.targets.length ? opts.targets.join(' ') : 'smoke (default)';
  console.log(`MiniSquad Test Run\nTargets: ${label}  (${suites.length} suite${suites.length === 1 ? '' : 's'}${opts.repeat > 1 ? ` x ${opts.repeat}` : ''})\nLogs: ${path.relative(ROOT, runDir)}/\n`);

  // build + serve
  let url = opts.url;
  if (!url) {
    if (opts.build) {
      process.stdout.write('setup: npm run build (tsc + vite) ... ');
      const b = await sh(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build']);
      fs.writeFileSync(path.join(runDir, '_build.log'), b.out);
      if (b.code !== 0) { console.log('failed'); return setupFail('npm run build failed (typecheck or vite build)', b.out); }
      console.log('ok');
    } else if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) return setupFail('--no-build but dist/index.html is missing; run `npm run build` first');
    const srv = await serveDir(path.join(ROOT, 'dist')); live.servers.push(srv); url = srv.url;
    console.log(`setup: serving dist/ at ${url}`);
  } else {
    try { const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); } catch (e) { return setupFail(`--url ${url} is not reachable`, String(e.cause?.code || e.message || e)); }
    console.log(`setup: using ${url}`);
  }
  await checkBrowser();

  // baselines
  const bases = new Map(); // suite name -> { url } | { error }
  if (opts.base === 'auto') {
    const refs = new Map();
    for (const s of suites) if (s.base) {
      if (!refs.has(s.base.ref)) {
        process.stdout.write(`setup: baseline ${s.base.label} (${s.base.ref}) ... `);
        const b = await baseDist(s.base.ref);
        if (b.error) { console.log('unavailable'); refs.set(s.base.ref, { error: b.error }); }
        else { const srv = await serveDir(b.dist); live.servers.push(srv); refs.set(s.base.ref, { url: srv.url }); console.log(srv.url); }
      }
      bases.set(s.name, refs.get(s.base.ref));
    }
  } else if (/^https?:\/\//.test(opts.base)) {
    for (const s of suites) bases.set(s.name, { url: opts.base });
  } else if (opts.base !== 'none') {
    // a git ref: every selected suite compares against that commit (e.g. --base HEAD~1 before a release)
    process.stdout.write(`setup: baseline ${opts.base} ... `);
    const b = await baseDist(opts.base);
    if (b.error) return setupFail(b.error);
    const srv = await serveDir(b.dist); live.servers.push(srv); console.log(srv.url);
    for (const s of suites) bases.set(s.name, { url: srv.url, label: opts.base });
  }
  console.log('');

  // run
  const rows = [];
  const width = Math.max(...suites.map((s) => s.name.length)) + (opts.repeat > 1 ? 4 : 0) + 4;
  outer: for (let rep = 1; rep <= opts.repeat; rep++) for (const s of suites) {
    const tag = opts.repeat > 1 ? `${s.name} #${rep}` : s.name;
    const b = bases.get(s.name);
    const env = { URL: url, BASE: b && b.url ? b.url : '' }; // '' = unset for every suite (`process.env.BASE || ''`)
    if ((s.out || opts.screens) && !process.env.OUT) { env.OUT = path.join(runDir, 'screens', s.name); fs.mkdirSync(env.OUT, { recursive: true }); }
    const logFile = path.join(runDir, `${s.name}${opts.repeat > 1 ? `-${rep}` : ''}.log`);
    let r;
    if (b && b.error) r = { status: 'ERROR', secs: 0, checks: null, failed: null, reason: b.error, failures: [] };
    else {
      if (opts.verbose) console.log(`---- ${tag} ----`);
      else process.stdout.write(`${tag} ${'.'.repeat(Math.max(2, width - tag.length))} `);
      r = await runOne(s, env, logFile, opts);
      if (opts.verbose) process.stdout.write(`---- ${tag} `);
    }
    const count = r.checks != null ? ` (${r.failed ? `${r.failed} of ${r.checks} checks failed` : `${r.checks} checks`})` : '';
    console.log(`${r.status}${count}${r.status === 'ERROR' || (r.reason && r.status !== 'DONE') ? ` - ${r.reason}` : ''}  ${r.secs.toFixed(1)}s${b && b.url ? `  [BASE ${b.label || (opts.base === 'auto' ? s.base.label : opts.base)}]` : ''}`);
    if (r.status === 'FAIL' || r.status === 'ERROR') {
      const shown = r.failures.slice(0, 12).map((l) => l.replace(/\s{2,}/g, '  ').slice(0, 320));
      for (const l of shown) console.log(`    ${l}`);
      if (r.failures.length > shown.length) console.log(`    ... ${r.failures.length - shown.length} more FAIL lines`);
      if (r.status === 'ERROR' && fs.existsSync(logFile)) for (const l of tail(fs.readFileSync(logFile, 'utf8'), 12)) console.log(`    | ${l.slice(0, 300)}`);
      if (fs.existsSync(logFile)) console.log(`    full output: ${path.relative(ROOT, logFile)}`);
    }
    rows.push({ suite: s.name, run: rep, kind: s.kind, status: r.status, checks: r.checks, failed: r.failed, secs: +r.secs.toFixed(1), reason: r.reason || undefined, base: b && b.url ? (b.label || (opts.base === 'auto' ? `${s.base.label} ${s.base.ref}` : opts.base)) : undefined, failures: r.failures.length ? r.failures.map((l) => l.replace(/\s{2,}/g, '  ').slice(0, 400)) : undefined, log: path.relative(ROOT, logFile) });
    if (opts.bail && (r.status === 'FAIL' || r.status === 'ERROR')) { console.log('\n--bail: stopping after the first problem'); break outer; }
  }
  await cleanup();

  // summary
  const n = (st) => rows.filter((r) => r.status === st).length;
  const secs = (Date.now() - t0) / 1000;
  const parts = [`${n('PASS')} passed`, `${n('FAIL')} failed`];
  if (n('ERROR')) parts.push(`${n('ERROR')} errored`);
  if (n('DONE')) parts.push(`${n('DONE')} reports done`);
  const notRun = suites.length * opts.repeat - rows.length;
  if (notRun) parts.push(`${notRun} not run (--bail)`);
  console.log(`\nResult: ${parts.join(', ')}`);
  console.log(`Duration: ${secs.toFixed(1)}s`);
  const code = n('ERROR') || notRun ? EXIT.error : n('FAIL') ? EXIT.failed : EXIT.ok;
  const summary = { targets: opts.targets.length ? opts.targets : ['smoke'], url, base: opts.base, startedAt: new Date(t0).toISOString(), secs: +secs.toFixed(1), exitCode: code, suites: rows };
  fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(summary, null, 2));
  if (opts.json) fs.writeFileSync(opts.json, JSON.stringify(summary, null, 2));
  if (code !== EXIT.ok) console.log(`Details: ${path.relative(ROOT, runDir)}/ (full logs, summary.json)`);
  return code;
}

main().then((code) => process.exit(code), async (e) => {
  console.error(`\nRUNNER ERROR: ${e && e.stack ? e.stack : e}`);
  await cleanup();
  process.exit(EXIT.setup);
});
