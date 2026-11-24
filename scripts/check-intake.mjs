// Local contract checks only: every outbound request is mocked.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const proxySource = await readFile(new URL('functions/api/design-requests.js', root), 'utf8');
const proxy = await import(`data:text/javascript;base64,${Buffer.from(proxySource).toString('base64')}`);
const browserSource = await readFile(new URL('submission.js', root), 'utf8');
const baseUrl = 'https://khac-rieng-classic.pages.dev';
const endpoint = `${baseUrl}/api/design-requests`;
const requestId = '73d155d6-3622-46fb-90c8-6a51a40d147a';
const pngBytes = Buffer.alloc(24);
Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(pngBytes);
pngBytes.write('IHDR', 12, 'ascii');
const png = `data:image/png;base64,${pngBytes.toString('base64')}`;
const payload = { name: 'Khách hàng', contact: 'customer@example.com', note: '', product: 'Classic', designs: { front: png, back: png } };
const env = { GOOGLE_APPS_SCRIPT_URL: 'https://script.google.com/macros/s/fake-deployment/exec', DESIGN_INTAKE_SECRET: 'mock-secret-used-only-in-local-checks' };
const goodResult = (id = requestId, extra = {}) => ({ success: true, requestId: id, stored: true, emailSent: true, ...extra });
let passed = 0;

async function check(name, callback) {
  await callback();
  passed += 1;
  process.stdout.write(`PASS ${name}\n`);
}

function context(body = { ...payload, requestId }, headers = {}) {
  return { env, request: new Request(endpoint, { method: 'POST', headers: { Origin: baseUrl, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }) };
}

async function withProxyFetch(fetchImpl, callback) {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try { return await callback(); } finally { globalThis.fetch = savedFetch; }
}

function browser(fetchImpl, storage = new Map()) {
  const timers = new Map(); let sequence = 0;
  const sandbox = {
    window: { location: { href: `${baseUrl}/`, origin: baseUrl } },
    fetch: (...args) => fetchImpl(...args), URL, AbortController, TextEncoder, Uint8Array,
    crypto: webcrypto,
    sessionStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    setTimeout: (callback, delay) => { const id = ++sequence; timers.set(id, { callback, delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
  };
  vm.runInNewContext(browserSource, sandbox, { filename: 'submission.js' });
  return { intake: sandbox.window.DesignIntake, timers, storage };
}

await check('configuration check has no upstream side effects', async () => {
  const result = await proxy.onRequestGet({ env: {} }).json();
  assert.equal(result.configured, false);
  assert.equal((await proxy.onRequestGet({ env }).json()).configured, true);
});

await check('cross-origin request rejected before reaching Google', async () => {
  await withProxyFetch(() => { throw new Error('Unexpected upstream call'); }, async () => {
    assert.equal((await proxy.onRequestPost(context(undefined, { Origin: 'https://attacker.example' }))).status, 403);
  });
});

await check('Chrome same-origin POST headers accepted; only server secret forwarded', async () => {
  await withProxyFetch(async (url, options) => {
    assert.equal(url, env.GOOGLE_APPS_SCRIPT_URL);
    assert.equal(options.redirect, 'follow');
    const forwarded = JSON.parse(options.body);
    assert.equal(forwarded.secret, env.DESIGN_INTAKE_SECRET);
    assert.equal(forwarded.product, 'Classic');
    assert.equal(forwarded.requestId, requestId);
    return Response.json(goodResult());
  }, async () => {
    const response = await proxy.onRequestPost(context({ ...payload, requestId, secret: 'client-secret', product: 'bad' }, { 'Sec-Fetch-Site': 'same-origin' }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).success, true);
  });
});

for (const [name, upstream] of [
  ['Google HTTP 200 success:false', { success: false, code: 'FAILED' }],
  ['Google HTTP 200 success string', goodResult(requestId, { success: 'true' })],
  ['Google response missing stored flag', { success: true, requestId, emailSent: true }],
  ['Google response for another request', goodResult('another-request-id')],
  ['Google response missing email result', { success: true, requestId, stored: true }],
]) {
  await check(`${name} cannot produce success`, async () => {
    await withProxyFetch(async () => Response.json(upstream), async () => {
      const response = await proxy.onRequestPost(context());
      assert.equal(response.status, 502);
      assert.equal((await response.json()).success, false);
    });
  });
}

await check('Google sign-in HTML cannot produce success', async () => {
  await withProxyFetch(async () => new Response('<html>Sign in</html>', { headers: { 'Content-Type': 'text/html' } }), async () => {
    const response = await proxy.onRequestPost(context());
    assert.equal(response.status, 502);
    assert.equal((await response.json()).success, false);
  });
});

await check('Drive stored + email failed is acknowledged without claiming email delivery', async () => {
  await withProxyFetch(async () => Response.json(goodResult(requestId, { emailSent: false, folderUrl: 'https://private.example/', secret: 'must-not-leak' })), async () => {
    const response = await proxy.onRequestPost(context());
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.stored, true);
    assert.equal(result.emailSent, false);
    assert.equal(result.secret, undefined);
    assert.equal(result.folderUrl, undefined);
  });
});

await check('proxy timeout reports uncertainty with matching request ID', async () => {
  const savedSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback) => savedSetTimeout(callback, 0);
  try {
    await withProxyFetch((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })), async () => {
      const response = await proxy.onRequestPost(context());
      const result = await response.json();
      assert.equal(response.status, 504);
      assert.equal(result.code, 'TIMEOUT');
      assert.equal(result.requestId, requestId);
    });
  } finally { globalThis.setTimeout = savedSetTimeout; }
});

await check('Google enabled selects same-origin endpoint', async () => {
  const fixture = browser(async () => Response.json({ configured: true }));
  const result = await fixture.intake.resolveEndpoint({ googleSubmissionEndpoint: '/api/design-requests', submissionEndpoint: 'https://formsubmit.co/recipient@example.com' });
  assert.equal(result.google, true);
  assert.equal(result.endpoint, endpoint);
});

await check('fallback allowed only when Google explicitly not configured', async () => {
  const fixture = browser(async () => Response.json({ configured: false }));
  const result = await fixture.intake.resolveEndpoint({ googleSubmissionEndpoint: '/api/design-requests', submissionEndpoint: 'https://formsubmit.co/recipient@example.com' });
  assert.equal(result.google, false);
  assert.equal(result.endpoint, 'https://formsubmit.co/recipient@example.com');
});

await check('health check HTML/error does not silently fallback', async () => {
  const fixture = browser(async () => new Response('<html>Unavailable</html>', { status: 500 }));
  await assert.rejects(fixture.intake.resolveEndpoint({ googleSubmissionEndpoint: '/api/design-requests', submissionEndpoint: 'https://formsubmit.co/recipient@example.com' }));
});

await check('browser rejects mismatched ID and reuses same ID for retry', async () => {
  const sent = [];
  const fixture = browser(async (_url, options) => {
    const body = JSON.parse(options.body); sent.push(body);
    return Response.json(goodResult('mismatched-request-id'));
  });
  await assert.rejects(fixture.intake.sendGoogle(endpoint, payload), (error) => error.requestId === sent[0].requestId);
  await assert.rejects(fixture.intake.sendGoogle(endpoint, payload));
  assert.equal(sent[0].requestId, sent[1].requestId);
});

await check('browser timeout keeps ID through page reload then accepts stored/email:false', async () => {
  const storage = new Map(); const sent = [];
  const first = browser((_url, options) => new Promise((_resolve, reject) => {
    sent.push(JSON.parse(options.body));
    options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    queueMicrotask(() => { for (const timer of first.timers.values()) timer.callback(); });
  }), storage);
  await assert.rejects(first.intake.sendGoogle(endpoint, payload), (error) => error.requestId === sent[0].requestId);
  const second = browser(async (_url, options) => {
    const body = JSON.parse(options.body); sent.push(body);
    return Response.json(goodResult(body.requestId, { emailSent: false }));
  }, storage);
  const result = await second.intake.sendGoogle(endpoint, payload);
  assert.equal(sent[0].requestId, sent[1].requestId);
  assert.equal(result.stored, true);
  assert.equal(result.emailSent, false);
  assert.equal(storage.size, 0);
});

await check('edited design receives a new ID after uncertain response', async () => {
  const sent = [];
  const fixture = browser(async (_url, options) => { sent.push(JSON.parse(options.body)); throw new Error('network'); });
  await assert.rejects(fixture.intake.sendGoogle(endpoint, payload));
  await assert.rejects(fixture.intake.sendGoogle(endpoint, { ...payload, note: 'changed request' }));
  assert.notEqual(sent[0].requestId, sent[1].requestId);
});

process.stdout.write(`Checked ${passed} mocked intake contracts; no real network requests or emails were sent.\n`);
