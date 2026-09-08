# Contributing to StateWork

Use Node 24.13+ (24.x recommended) and npm. Run `npm ci`, then `npm run check`. Browser checks use `npx playwright install chromium firefox webkit` and `npm run test:e2e`.

The backend is the product. Keep domain meaning independent of rendering, device, clock and network. Route every untrusted mutation through the shared SDK. Keep role assignment in trusted host code. Do not implement a second set of task rules in a renderer. Preserve stable IDs, labeled facts, text alternatives and untimed keyboard paths.

Read [the architecture](docs/ARCHITECTURE.md) before changing contracts. New commands need runtime schemas, pure transitions, failure/atomicity tests, type declarations, API documentation and compatibility decisions. A storage adapter must pass the shared conformance suite, including rollback, idempotency, membership and reopen durability where applicable. A renderer needs actual interaction and perception testing, not only screenshots.

Use namespaced extensions for app-specific metadata. Do not execute code specified in saved work or renderer IDs. Keep unknown extension data through round trips. New storage or domain schema versions require explicit migrations; do not silently reinterpret existing snapshots.

`npm run format` formats maintained code and JSON. `npm run lint` verifies formatting and package boundaries. CI is provided for Windows/Linux/macOS. Hardware and assistive-technology checks should record actual device/browser versions and observed limits. Do not turn automated accessibility checks into blanket accessibility claims.

Do not commit `.statework/`, tokens, exports of real work, build caches or private test data. Original example work is fictional and intentionally small. Changes should include a brief account of resulting behavior and checks performed. Code and original example data use the repository MIT license.
