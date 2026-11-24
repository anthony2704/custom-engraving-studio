(() => {
  'use strict';
  const PENDING_KEY = 'classic-pending-design-request';
  let pendingRequest = null;

  async function resolveEndpoint(config) {
    const preferred = config.googleSubmissionEndpoint;
    if (preferred) {
      const endpoint = new URL(preferred, window.location.href);
      if (endpoint.origin !== window.location.origin) throw new Error('INVALID_ENDPOINT');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(endpoint.href, { cache: 'no-store', signal: controller.signal });
        const status = await response.json();
        if (!response.ok || typeof status.configured !== 'boolean') throw new Error('INVALID_ENDPOINT');
        if (status.configured) return { endpoint: endpoint.href, google: true };
      } finally { clearTimeout(timer); }
    }
    // Temporary migration path until the owner configures the Google deployment.
    return { endpoint: config.submissionEndpoint || '', google: false };
  }

  async function requestIdFor(payload) {
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const fingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    try { pendingRequest = JSON.parse(sessionStorage.getItem(PENDING_KEY)) || pendingRequest; } catch (_) { /* Storage can be disabled. */ }
    if (pendingRequest?.fingerprint !== fingerprint || !/^[a-zA-Z0-9_-]{16,100}$/.test(pendingRequest.requestId || '')) {
      pendingRequest = { fingerprint, requestId: crypto.randomUUID() };
      try { sessionStorage.setItem(PENDING_KEY, JSON.stringify(pendingRequest)); } catch (_) { /* Keep the ID in memory. */ }
    }
    return pendingRequest.requestId;
  }

  async function sendGoogle(endpoint, payload) {
    const requestId = await requestIdFor(payload);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 75000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ ...payload, requestId }), signal: controller.signal
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.success !== true || result.stored !== true
        || result.requestId !== requestId || typeof result.emailSent !== 'boolean') {
        const error = new Error(result?.code === 'TOO_LARGE' ? 'TOO_LARGE' : 'SUBMISSION_UNCONFIRMED');
        error.requestId = requestId;
        throw error;
      }
      pendingRequest = null;
      try { sessionStorage.removeItem(PENDING_KEY); } catch (_) { /* Storage can be disabled. */ }
      return result;
    } catch (error) {
      error.requestId = requestId;
      throw error;
    } finally { clearTimeout(timer); }
  }

  window.DesignIntake = { resolveEndpoint, sendGoogle };
})();
