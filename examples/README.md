# Example projects

Sample workspaces for trying igltf-editor without creating assets from scratch.

## Status

**No bundled example yet.** Add a minimal project here before or with the first public release.

## Suggested layout (for maintainers)

```text
examples/hello-interactive/
  README.md           # what the demo shows, how to open it
  project.json        # v2 document (or instructions to register folder)
  assets/
    Cube.glb          # small CC0 or internally owned model
    ClickSpin.js      # simple EventInteraction sample
```

## How users should open an example (once added)

1. Start backend + frontend ([GETTING_STARTED.md](../GETTING_STARTED.md)).
2. **Projects hub → Open existing** → select `examples/hello-interactive/`.
3. **Build & Play**.

Alternatively: `POST /studio/projects/register` with `{ "projectDirectory": "<absolute path>" }`.

## Licensing

Example assets must be **redistributable** (CC0, Apache-compatible, or owned by the project). Document attribution in the example README.
