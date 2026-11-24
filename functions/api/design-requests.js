const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_BODY_BYTES = 14 * 1024 * 1024;
const REQUEST_ID = /^[a-zA-Z0-9_-]{16,100}$/;
const SCRIPT_URL = /^https:\/\/script\.google\.com\/macros\/s\/[a-zA-Z0-9_-]+\/exec$/;

function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

function isConfigured(env) {
  return SCRIPT_URL.test(env.GOOGLE_APPS_SCRIPT_URL || '')
    && typeof env.DESIGN_INTAKE_SECRET === 'string'
    && env.DESIGN_INTAKE_SECRET.length >= 32 && env.DESIGN_INTAKE_SECRET.length <= 256;
}

async function readBody(request) {
  if (Number(request.headers.get('Content-Length')) > MAX_BODY_BYTES) throw new Error('TOO_LARGE');
  if (!request.body) throw new Error('INVALID_REQUEST');
  const reader = request.body.getReader(); const parts = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) { await reader.cancel(); throw new Error('TOO_LARGE'); }
      parts.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch (_) { throw new Error('INVALID_REQUEST'); }
}

function textField(value, limit, required = false) {
  if (typeof value !== 'string' || value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new Error('INVALID_REQUEST');
  const result = value.trim();
  if (required && !result) throw new Error('INVALID_REQUEST');
  return result;
}

function pngImage(value) {
  if (typeof value !== 'string' || !value.startsWith('data:image/png;base64,')) throw new Error('INVALID_IMAGES');
  const base64 = value.slice(22);
  if (base64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) throw new Error('TOO_LARGE');
  if (base64.length % 4 !== 0) throw new Error('INVALID_IMAGES');
  const size = base64.length / 4 * 3 - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
  if (size < 24) throw new Error('INVALID_IMAGES');
  if (size > MAX_IMAGE_BYTES) throw new Error('TOO_LARGE');
  const header = atob(base64.slice(0, 32));
  if (![137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => header.charCodeAt(i) === byte)
    || header.slice(12, 16) !== 'IHDR') throw new Error('INVALID_IMAGES');
  return value;
}

export function onRequestGet({ env }) {
  return json({ configured: isConfigured(env), provider: 'google-apps-script' });
}

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  if (request.headers.get('Origin') !== url.origin
    || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
    return json({ success: false, code: 'FORBIDDEN', message: 'Vui lòng gửi yêu cầu từ trang thiết kế.' }, 403);
  }
  if (!isConfigured(env)) return json({ success: false, code: 'NOT_CONFIGURED', message: 'Cổng nhận thiết kế Google chưa được kết nối.' }, 503);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) return json({ success: false, code: 'INVALID_REQUEST', message: 'Dữ liệu gửi không hợp lệ.' }, 415);

  let payload;
  try {
    const data = await readBody(request);
    if (!data || typeof data !== 'object' || typeof data.requestId !== 'string' || !REQUEST_ID.test(data.requestId)) throw new Error('INVALID_REQUEST');
    payload = {
      secret: env.DESIGN_INTAKE_SECRET, requestId: data.requestId,
      name: textField(data.name, 120, true), contact: textField(data.contact, 200, true),
      note: textField(data.note || '', 3000), product: 'Classic',
      designs: { front: pngImage(data.designs?.front), back: pngImage(data.designs?.back) }
    };
    if (/[\r\n]/.test(payload.name + payload.contact)) throw new Error('INVALID_REQUEST');
  } catch (error) {
    const tooLarge = error.message === 'TOO_LARGE';
    return json({ success: false, code: tooLarge ? 'TOO_LARGE' : 'INVALID_REQUEST', message: tooLarge ? 'Ảnh quá lớn. Mỗi mặt cần nhỏ hơn 5 MB.' : 'Vui lòng kiểm tra thông tin và ảnh thiết kế của cả hai mặt.' }, tooLarge ? 413 : 400);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 65000);
  try {
    const response = await fetch(env.GOOGLE_APPS_SCRIPT_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload), redirect: 'follow', signal: controller.signal
    });
    const result = await response.json().catch(() => null);
    // Google can return an HTML sign-in/error page or HTTP 200 with success:false.
    if (!response.ok || result?.success !== true || result.stored !== true
      || result.requestId !== payload.requestId || typeof result.emailSent !== 'boolean') {
      console.error('Design intake rejected', { requestId: payload.requestId, status: response.status, code: typeof result?.code === 'string' ? result.code.slice(0, 60) : 'INVALID_RESPONSE' });
      return json({ success: false, requestId: payload.requestId, code: 'UPSTREAM_ERROR', message: 'Chưa xác nhận được đơn đã lưu. Vui lòng thử lại với cùng mã yêu cầu hoặc tải ảnh về.' }, 502);
    }
    // Private Drive URLs and backend details stay on the server.
    return json({ success: true, requestId: payload.requestId, stored: true, emailSent: result.emailSent }, 200);
  } catch (error) {
    const timedOut = controller.signal.aborted;
    console.error('Design intake unavailable', { requestId: payload.requestId, code: timedOut ? 'TIMEOUT' : 'NETWORK_ERROR' });
    return json({ success: false, requestId: payload.requestId, code: timedOut ? 'TIMEOUT' : 'UNAVAILABLE', message: 'Chưa nhận được xác nhận lưu đơn. Vui lòng thử lại; mã yêu cầu được giữ để tránh tạo đơn trùng.' }, timedOut ? 504 : 502);
  } finally { clearTimeout(timeout); }
}
