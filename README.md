# Khắc riêng

Buildless static product customizer for the Classic brushed-gold lighter, with separate front and back faces.

## Receiving customer designs

Set `submissionEndpoint` in `config.js` to an HTTPS endpoint. FormSubmit uses its native multipart form endpoint and receives one combined PNG showing both product faces. Other same-origin or CORS-enabled endpoints receive a JSON `POST` with:

- `name`, `contact`, `note`, and `product`
- `designs.front` and `designs.back`, each a PNG data URL

The JSON endpoint should send the images to the shop by email or save the files to the shop's Drive, then return a successful 2xx response. Keep email-provider credentials and Drive authorization on the server. FormSubmit receives a native multipart form with one combined PNG and redirects to a same-origin completion page. The design is saved locally before that full-page submission. With no endpoint configured, or if the image cannot be prepared, the form offers the customer a two-face ZIP download.

The editor supports text, preset vector artwork, basic geometric shapes, uploaded PNG/JPG/WEBP/SVG files, front/back views, drag positioning, size and color adjustments, undo/redo, and an IndexedDB draft on the current browser.

Customers can download both faces together as a ZIP containing separate front and back PNG files.
