# Security boundary

StateWork 0.1.0 is a personal local application and developer foundation. It is not a hosted multi-tenant service. The HTTP entry point binds only `127.0.0.1`. Do not expose it through a reverse proxy or tunnel as a company deployment. A new network host needs identity/session design, TLS, origin policy, quotas, audit review and workload testing.

## Implemented controls

- Loopback bind, exact allowed Host values and same-origin checks reject DNS rebinding and browser cross-origin calls. No CORS permission is issued.
- Every `/v1` operation requires a bearer token whose SHA-256 hash is stored in SQLite. Per-workspace membership is checked inside each transaction. A connection cannot set its identity/role in a command.
- The local reference browser bootstraps using POST `/local/session` with matching Origin, `Sec-Fetch-Site: same-origin` and a custom header. Cross-origin JavaScript cannot set up this request without a preflight, which is not allowed. The returned token is held in browser memory; responses are no-store. A local process can forge these headers and is already inside the trusted filesystem/OS boundary.
- Strict schemas, bounded bodies/batches/nesting, SQL parameters, data-only extension metadata, immutable IDs, optimistic versions, durable idempotency and transactional graph checks protect the domain.
- Content Security Policy, frame denial, no-referrer and MIME sniffing protection are applied. Work text is HTML-escaped. The static root is only the built reference assets; the database, token and source tree are not served.
- No token values, work content or stack traces are sent in unexpected HTTP errors. Tokens are not placed in links. No external scripts, fonts, telemetry, ads or LLM services are loaded.

## Limits and trust

Direct filesystem access, `WorkService.connect`, store provisioning and executable adapters are trusted host capabilities. They are not sandboxed. Anyone able to run arbitrary local code as the same OS user can access the data. Reader/editor roles are useful boundaries for correctly authenticated adapters, not a defense against the filesystem owner. Owner and editor share work-mutation privileges; neither can provision membership through commands.

The bundled host does not implement token expiry, browser logout/account switching, OS keychain storage, end-to-end encryption, distributed rate limits, network identities or isolated untrusted plugins. Full backups contain all work and authentication hashes. Work extensions and MCP text are untrusted data; an integrating agent must not follow embedded instructions merely because they appeared in an observation.

The local browser auto-connects as the personal owner. A custom application using scoped tokens must provide its own sign-in flow and should omit the local bootstrap endpoint. `createServer` can be used without `localToken` for that purpose.

## Reporting

Until a repository/security contact is published, report privately to the maintainer rather than filing live tokens or private workspace exports in public issues. A GitHub publisher should enable private vulnerability reporting and replace this paragraph with their preferred private contact route. Run `npm audit` and the full checks before a release; dependency pinning is not a security audit.
