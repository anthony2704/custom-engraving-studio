# Khắc riêng

Buildless static product customizer for the Classic brushed-gold lighter, with separate front and back faces.

## Receiving customer designs

The preferred receiver is Google Apps Script through the same-origin Pages Function at `/api/design-requests`. Setup instructions are in `ket-noi-google.html`; Apps Script source is in `integrations/google-apps-script/Code.gs`. The downloadable copy at `dist/google-apps-script-code.txt` must match that source.

One-time Google setup: paste `Code.gs` into a new project, run `setup()`, and deploy a Web app executing as the owner with anonymous **Anyone** access. Store the `/exec` URL as `GOOGLE_APPS_SCRIPT_URL` and the generated `DESIGN_INTAKE_SECRET` Script Property as an encrypted Cloudflare Pages secret of the same name. Redeploy Pages after saving both values. No credentials belong in browser code or source control.

Google saves separate front/back PNGs and `request.json` in the owner's private Drive, then sends both attachments and previews to `khoa.v.nguyen.work@gmail.com`. A stored request is accepted even if email fails; the installed five-minute retry trigger retries pending emails. Consumer Gmail's Apps Script sending quota is currently 100 recipients per day. There is no guaranteed email arrival time. `setup()` authorizes services but sends no email.

The browser uses Google only when the Function reports valid configuration. Until then it retains FormSubmit as the migration fallback. A failed Google request is never retried through FormSubmit. The request ID survives retries/timeouts in the browser tab; Apps Script rejects different content under an existing ID. Success requires explicit `success: true`, `stored: true`, and the matching ID; HTTP 200 or an iframe load cannot count as success. Mail delivery is reported separately as `emailSent`. Email retry is at least once: a rare failure after sending but before saving the send result can produce a duplicate email carrying the same request ID.

The Pages Function receives a JSON `POST` with:

- `requestId`, `name`, `contact`, `note`, and `product`
- `designs.front` and `designs.back`, each a PNG data URL

The Function adds the shared secret server side and follows Google's ContentService redirect to read JSON. It returns no private Drive URLs. JSON is limited to 14 MiB; each PNG to 5 MiB. FormSubmit fallback still uses native multipart with one combined PNG and a full-page redirect. The form offers ZIP downloads if the receiver cannot confirm receipt.

Local contract checks (mocked network, Drive and mail; no messages sent): `node scripts/check-intake.mjs` and `node scripts/check-google-apps-script.mjs`. Real Google authorization, deployment and a real design submission are required to measure email latency and confirm delivery.

The editor supports text, preset vector artwork, basic geometric shapes, uploaded PNG/JPG/WEBP/SVG files, front/back views, drag positioning, size and color adjustments, undo/redo, and an IndexedDB draft on the current browser.

Customers can download both faces together as a ZIP containing separate front and back PNG files.
