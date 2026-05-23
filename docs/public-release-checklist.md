# Public release — maintainer checklist

Items the maintainers must provide or decide before / when publishing on GitHub.  
Everything else (docs, CI, CONTRIBUTING, …) is prepared in the repo.

## Required from you

- [ ] **GitHub organisation / repo URLs** — confirm final paths (README links assume `UMI3D/interactive-gltf-engine` and `UMI3D/interactive-gltf-specs`; update if different)
- [ ] **Screenshots or GIF** — editor + Play (add to `docs/images/` and embed in root README)
- [ ] **Example project** — small `.glb` + sample script under `examples/hello-interactive/` (see [examples/README.md](examples/README.md)); assets must be redistributable
- [ ] **Security contact** — replace generic wording in [SECURITY.md](SECURITY.md) with a real email or GitHub Security advisory process
- [ ] **First release tag** — e.g. `v0.1.0` on GitHub; align [CHANGELOG.md](CHANGELOG.md) date and release notes
- [ ] **Publish interactive-gltf-specs** — if not already public, coordinate simultaneous or prior release so README links work

## Recommended

- [ ] **Windows installer** — attach `setup.exe` from [tauri-build/](tauri-build/) to GitHub Release (optional binary asset)
- [ ] **Demo video** — 1–2 min walkthrough (YouTube / GitHub attachment); link from README
- [ ] **Code of Conduct** — org standard or [Contributor Covenant](https://www.contributor-covenant.org/) if you expect external contributors
- [ ] **GitHub issue / PR templates** — `.github/ISSUE_TEMPLATE/`, `pull_request_template.md`
- [ ] **CI badge** — add to README after first green run on `main`:
  `![CI](https://github.com/ORG/interactive-gltf-engine/actions/workflows/ci.yml/badge.svg)`
- [ ] **Repo description & topics** on GitHub — e.g. `gltf`, `interactive-3d`, `threejs`, `editor`, `mcp`

## Verify before making public

- [ ] No secrets in git history (`.env`, tokens, private paths in committed `project.json`)
- [ ] `data/` and user workspaces not tracked
- [ ] Licence headers / third-party notices if you bundle non-Apache assets in examples
- [ ] Run locally: [GETTING_STARTED.md](GETTING_STARTED.md) on a clean machine or VM

## Already done in repo

- [x] Public-oriented [README.md](README.md)
- [x] [GETTING_STARTED.md](GETTING_STARTED.md)
- [x] [ROADMAP.md](ROADMAP.md) aligned with milestone 1
- [x] [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), [CHANGELOG.md](CHANGELOG.md)
- [x] [docs/](docs/) product documentation
- [x] CI workflow [`.github/workflows/ci.yml`](.github/workflows/ci.yml) (backend + frontend tests)
