# Security policy

## Supported versions

| Version | Supported |
|---------|-----------|
| `0.1.x` (Milestone 1 POC) | Best effort |

This project is an **early reference implementation**, not a hardened production service.

## Reporting a vulnerability

Please **do not** open public GitHub issues for security-sensitive reports.

Report privately to the maintainers of the **UMI3D / interactive-gltf** project (use your organisation's usual security contact or repository owner email on GitHub).

Include: description, reproduction steps, impact, and affected component (backend, frontend, MCP, desktop).

## Known limitations (Milestone 1)

- **No authentication** — anyone who can reach the API can read/write projects on that host.
- **Local-first API** — intended for `127.0.0.1` / dev networks; do not expose raw to the internet without a reverse proxy and auth.
- **MCP scene tools** — can mutate the live editor scene when enabled; workspace folders include agent policy files but trust the MCP client and editor user.
- **Script execution in Play** — authored JavaScript runs with page privileges; treat untrusted scripts like any web code.
- **Path traversal** — `/files/…` uses normalization checks; report bypasses privately.

We will acknowledge reports within a reasonable timeframe and coordinate fixes on `main`.
