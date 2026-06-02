# Changelog

## 2.0.0-rc.1

- Split the memory kernel into an independently installable core package for GitHub source distribution.
- Added a stable Cogmem home directory with TOML configuration at `~/.cogmem/config.toml`.
- Added `core.vector_dimension` for TOML-based embedding dimension configuration, including high-dimension warnings.
- Removed legacy env-file/global-env configuration entrypoints; TOML is now the only supported configuration surface.
- Added `cogmem-init` and `cogmem-doctor` for first-run setup and validation.
- Added `cogmem-import-openclaw` and `cogmem-import-hermes` for command-triggered migration from existing agent workspaces.
- Added `KernelAgentMemoryBackend` for external agent integrations.
- Routed `KernelAgentMemoryBackend.recall()` through universe navigation by default, with BrainRecall retained as fallback.
- Exported the pulse/universe retrieval orchestrators for advanced agent integrations.
- Added core-native OpenClaw and Hermes workspace profiles.
- Added agent-facing OpenClaw and Hermes runbooks under `examples/*-backend/AGENTS.md`.
- Added snapshot, vector backend, governance, PII redaction, and encryption release hardening.
- Added a GitHub-only release checklist; `npm pack --dry-run` is used for artifact verification, not npm publishing.
