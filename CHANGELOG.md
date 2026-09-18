# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and releases use [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-07-25

### Added

- Local OpenAI-compatible `POST /v1/responses` and `POST /v1/chat/completions` endpoints with streaming and non-streaming modes.
- Chrome/CDP login bootstrap, reusable auth snapshots, DeepSeek Web PoW solving, and persistent session lineage.
- Reasoning/output mapping, prompt-based function-call compatibility, Web search toggling, API-key protection, and model discovery.
- Pi integration guidance for both `openai-completions` and `openai-responses`.
- CI, contributor/security policy, architecture/API documentation, and release metadata.

### Security

- Loopback binding by default and owner-only runtime credential files.
- Runtime credentials, sessions, API keys, and Chrome profiles excluded from Git.

[Unreleased]: https://github.com/kittors/deepseek-web-api/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/kittors/deepseek-web-api/releases/tag/v0.1.0
