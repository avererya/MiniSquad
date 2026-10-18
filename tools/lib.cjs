// Shared helpers for the tools/*.cjs suites and the test runner (tools/test.cjs). Phase 2 (test infrastructure).
//
// Suites keep their own console format (one `PASS  name  detail` / `FAIL  name  detail` line per check) and add one
// machine-readable line at the end, so the runner reads real totals instead of guessing from the log:
//   ##minisquad-result {"checks":86,"failed":0,"errors":0}
// Exit codes: 0 every check passed, 1 a check failed or the page threw, 2 the suite crashed before finishing.
//
// Usage in a suite:
//   const { chromium, URL, OUT, createChecks, runSuite } = require('./lib.cjs');
//   runSuite(async () => {
//     const { check, finish } = createChecks({ pad: 74 });
//     ... check('name', ok, detail) ...
//     return finish(pageErrors);   // prints errors + the result line, returns the exit code
//   });
const fs = require('fs');
const path = require('path');
const http = require('http');

const RESULT_TAG = '##minisquad-result ';
const URL = process.env.URL || 'http://localhost:4173/';
const BASE = process.env.BASE || '';
const OUT = process.env.OUT || '';

/** Playwright: $PLAYWRIGHT_PATH, a local install, or the global one the cloud image ships at /opt/node22. */
function loadPlaywright() {
  const tries = [process.env.PLAYWRIGHT_PATH, 'playwright', '/opt/node22/lib/node_modules/playwright'].filter(Boolean);
  for (const t of tries) { try { return require(t); } catch { /* next */ } }
  throw new Error(`Playwright not found (tried ${tries.join(', ')}). Install it globally or set PLAYWRIGHT_PATH.`);
}

/** check(name, ok, detail) prints one PASS / FAIL line; finish(errors) prints page errors and the result line. */
function createChecks({ pad = 90, detailMax = 300 } = {}) {
  const st = { checks: 0, failed: 0, failures: [] };
  const check = (name, ok, detail = '') => {
    st.checks++;
    if (!ok) { st.failed++; st.failures.push(name); }
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${String(name).padEnd(pad)} ${String(detail ?? '').replace(/\s+/g, ' ').slice(0, detailMax)}`);
    return !!ok;
  };
  const finish = (errors = []) => {
    for (const e of errors) console.log(`ERROR ${String(e).slice(0, 500)}`);
    emitResult({ checks: st.checks, failed: st.failed, errors: errors.length });
    return st.failed || errors.length ? 1 : 0;
  };
  return { check, finish, state: st };
}

function emitResult(obj) { console.log(RESULT_TAG + JSON.stringify(obj)); }

/** The last result line in a suite's output, or null. */
function parseResult(text) {
  let last = null;
  for (const line of String(text).split('\n')) if (line.startsWith(RESULT_TAG)) { try { last = JSON.parse(line.slice(RESULT_TAG.length)); } catch { /* ignore */ } }
  return last;
}

/** Runs an async suite body that resolves to an exit code; a throw prints the stack and exits 2 (crash, not a failed check). */
function runSuite(main) {
  Promise.resolve().then(main).then((code) => process.exit(code ?? 0), (e) => {
    console.error(e && e.stack ? e.stack : e);
    emitResult({ crashed: String(e && e.message ? e.message : e).slice(0, 300) });
    process.exit(2);
  });
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };

/** Static server for a built dist/ on a free port (127.0.0.1). Resolves { url, close() }. */
function serveDir(dir, port = 0) {
  const root = path.resolve(dir);
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new globalThis.URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(root, p);
    if (!file.startsWith(root + path.sep) && file !== root) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(data);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const { port: p } = server.address();
      resolve({ url: `http://127.0.0.1:${p}/`, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

module.exports = { RESULT_TAG, URL, BASE, OUT, loadPlaywright, get chromium() { return loadPlaywright().chromium; }, createChecks, emitResult, parseResult, runSuite, serveDir };
