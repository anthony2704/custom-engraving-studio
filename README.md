# Khắc riêng

Buildless static product customizer for the Classic Navy Matte lighter mockup.

## Receiving customer designs

Set `submissionEndpoint` in `config.js` to an HTTPS endpoint that accepts a JSON `POST` with:

- `name`, `contact`, `note`, and `product`
- `designs.front` and `designs.back`, each a PNG data URL

The endpoint should send the images to the shop by email or save the files to the shop's Drive, then return a successful 2xx response. Keep email-provider credentials and Drive authorization on the server. With no endpoint configured, the form clearly reports that delivery is not connected and offers the customer a two-image PNG download.

The editor supports text, preset vector artwork, uploaded PNG/JPG/WEBP/SVG files, front/back views, drag positioning, size and color adjustments, undo/redo, and an IndexedDB draft on the current browser.
