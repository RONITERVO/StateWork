# Local release and GitHub handoff

Nothing in the development or release scripts publishes a repository, npm package or website. The package namespace and product name are provisional; verify availability before publishing to a registry.

1. `npm ci`
2. `npm run check`
3. `npx playwright install chromium firefox webkit`
4. `npm run test:e2e`
5. `npm run release:local`
6. Review `docs/ACCEPTANCE.md`, `SECURITY.md`, licenses and the files you intend to publish.

The release command creates five library/tool/server npm tarballs under `artifacts/release/0.1.0/`, SHA-256 checksums, and a clean-source tarball. It installs the public tarballs together into a temporary directory and verifies imports, SQLite, CLI help and MCP discovery without relying on workspace symlinks. The reference application remains part of the source release and is built with `npm run build`; its package is private. The standalone server tarball hosts the API without UI assets unless the host supplies a built `staticRoot`.

The source archive uses an explicit allowlist and excludes `.git`, `node_modules`, `.statework`, database files, artifacts, browser reports and built output. It includes the lockfile, original data, documentation and tests. No personal exports are included. Dependency notices are generated from installed dependency metadata/license files; review them when changing dependencies.

CI runs the same checks on three desktop OSes and browser checks on Linux. Check the repository's Actions results for remote run status. Before publishing registry packages, establish a private security contact, review namespace availability, run actual assistive-technology/device trials relevant to advertised support, and document any changed limits.

The source repository is [RONITERVO/StateWork](https://github.com/RONITERVO/StateWork), with `main` as the primary branch. Publishing npm packages or uploading release assets requires a separate explicit maintainer action.
