# Khắc riêng

Buildless static product customizer for the Classic brushed-gold lighter, with separate front and back faces.

## Receiving customer designs

Set `submissionEndpoint` in `config.js` to an HTTPS endpoint. FormSubmit uses its native multipart form endpoint so the front and back PNGs can be attached separately. Other same-origin or CORS-enabled endpoints receive a JSON `POST` with:

- `name`, `contact`, `note`, and `product`
- `designs.front` and `designs.back`, each a PNG data URL

The JSON endpoint should send the images to the shop by email or save the files to the shop's Drive, then return a successful 2xx response. Keep email-provider credentials and Drive authorization on the server. FormSubmit uses a same-origin completion page to confirm its redirect. With no endpoint configured, or if delivery cannot be confirmed, the form offers the customer a two-image PNG download.

The editor supports text, preset vector artwork, basic geometric shapes, uploaded PNG/JPG/WEBP/SVG files, front/back views, drag positioning, size and color adjustments, undo/redo, and an IndexedDB draft on the current browser.
