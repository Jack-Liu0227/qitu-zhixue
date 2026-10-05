# Upstream record

- Upstream project: https://github.com/earendil-works/pi
- Upstream package: `packages/ai`
- Upstream version: `0.87.1`
- Upstream commit: `f07218c4d4bbc12bef056a7058c3dd49dfe41abe`
- License: MIT; original `LICENSE` is retained in this package.

## Local changes

- Source is under `src/pi/` rather than exposed as the package root.
- Package metadata and build scripts are owned by Qitu Zhixue.
- The package root exposes Qitu runtime types and adapters only.
- Provider/model selection and credentials are supplied by the Qitu server runtime.
- Production does not use Pi's CLI, TUI, `auth.json`, OAuth login flow, or ambient credential store.
- Qitu-specific adapters are implemented outside the upstream source tree.

## Sync policy

Any future upstream update must record the new version and commit, rerun the package and API tests, and review credential, telemetry, transport, and tool-execution boundaries before adoption.
