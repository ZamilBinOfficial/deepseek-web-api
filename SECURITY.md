# Security Policy

## Supported version

Security fixes target the latest release and the `main` branch.

## Reporting a vulnerability

Use GitHub's **Security → Report a vulnerability** flow for this repository. If private vulnerability reporting is unavailable, contact the maintainer through the `ZamilBinOfficial` GitHub profile before sharing details. Do not open a public issue with credentials, cookies, exploit steps, or account data.

Include the affected version/commit, impact, reproduction steps, and a minimal sanitized request or log. You should receive an acknowledgement within seven days.

## Deployment and account risk

This project is an **unofficial** adapter for private DeepSeek Web endpoints. It is not affiliated with or supported by DeepSeek or OpenAI.

- Keep the default loopback bind (`127.0.0.1`). Do not expose the server directly to the public Internet.
- Every `/v1/*` route requires an API key, but API-key authentication alone is not a complete Internet-facing security boundary.
- `data/auth.json`, `data/.api-key`, `data/sessions.json`, and `data/chrome-profile/` are sensitive. Never commit, upload, attach, or include them in images.
- Use a dedicated Chrome profile and protect the host account. Compromise of the runtime data can compromise the logged-in DeepSeek session.
- Web automation and private API usage may trigger account restrictions. Review applicable terms and accept the account risk before use.
