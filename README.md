# sf-plugin-remote-login

Salesforce CLI plugin that adds one command, `sf org login remote`, for logging in to an org from a machine that has no browser: a container, a remote Linux box, a CI runner, or a server where an AI coding agent runs.

The CLI prints the normal Salesforce authorization URL and waits. You open the URL in any browser on any device (an iPhone is enough), log in as usual (SSO and MFA included), and paste the final redirect URL back into the waiting terminal. The CLI validates it, exchanges the authorization code for tokens, and stores the org exactly like `sf org login web` does.

This is a proof of concept for the upstream feature request in forcedotcom/cli (link in [Upstream proposal](#upstream-proposal)).

## Install

Requires Salesforce CLI (`sf`) 2.x and Node.js 20 or newer on the machine that runs the CLI.

```bash
sf plugins install https://github.com/Damecek/sf-plugin-remote-login.git
```

The plugin is not published to npm and is not signed by Salesforce, so `sf` asks for confirmation (in scripts, pipe `echo y` into the command). Installing from a git URL builds it locally, so `npm` needs network access during the install.

## Usage

```bash
sf org login remote --alias my-org
```

```text
Open this URL in any browser (phone, tablet, another computer):

https://login.salesforce.com/services/oauth2/authorize?state=...&code_challenge=...&client_id=PlatformCLI&redirect_uri=http%3A%2F%2Flocalhost%3A1717%2FOauthRedirect

Complete the login. The browser will then try to open http://localhost:1717/OauthRedirect and fail to load (this is expected). Copy the full address from the browser's address bar and paste it below. The input is hidden.
? Callback URL [input is masked]
Successfully authorized developer@example.com with org ID 00D...
```

Flags:

| Flag | Meaning |
| --- | --- |
| `-a, --alias` | Alias for the org. |
| `-r, --instance-url` | Login URL. Default: the `org-instance-url` config value or `https://login.salesforce.com`. Use `https://test.salesforce.com` for sandboxes or your My Domain URL for SSO. |
| `-s, --set-default` | Make the org the default target org. |
| `-d, --set-default-dev-hub` | Make the org the default Dev Hub. |
| `--timeout` | Minutes to wait for the pasted URL (default 15). |
| `--json` | JSON output (tokens are redacted, same as `org login web`). |

After the login every standard command works as usual:

```bash
sf org list auth
sf org display --target-org my-org
sf data query --target-org my-org --query "SELECT Id FROM User LIMIT 1"
```

### Copying the redirect URL on a phone

After you log in, Salesforce redirects the browser to `http://localhost:1717/OauthRedirect?code=...&state=...`. On your phone `localhost` is the phone itself, so the page cannot load. That is fine: the authorization code is already in the address bar.

- iOS Safari: tap the address bar, tap the URL text, choose Select All, then Copy. Paste it into the terminal (or into the chat with your agent, see the security notes below).
- Chrome (Android, desktop): tap or click the address bar, select all, copy.

The pasted text may contain surrounding whitespace or a trailing newline. The command trims it.

## How it works

The plugin uses the same building blocks as `sf org login web` in `@salesforce/core`, and the same built-in connected app (`PlatformCLI`), so no connected app setup is required.

1. It creates a jsforce `OAuth2` instance with `useVerifier: true`. jsforce generates the PKCE code verifier and puts the S256 code challenge into the URL.
2. `AuthInfo.getAuthorizationUrl` builds the authorization URL with a random 32-byte `state`, `prompt=login`, and the default scopes `refresh_token api web`.
3. The command prints the URL and reads the callback URL through the hidden `secretPrompt` of `@salesforce/sf-plugins-core`.
4. `parseCallbackUrl` in `src/remoteLogin.ts` checks that the pasted URL has exactly the expected origin and path (`http://localhost:1717/OauthRedirect`, port taken from `oauthLocalPort` in `sfdx-project.json` if set), that `state` matches, that there is no `error` parameter, and that a `code` is present.
5. `AuthInfo.create({ oauth2Options, oauth2 })` exchanges the code for tokens with the original PKCE verifier and `AuthInfo.save()` writes the auth file through the CLI's standard, encrypted credential storage. Alias and default-org flags go through `handleAliasAndDefaultSettings`.

The only real difference from `sf org login web` is step 3: instead of listening on `localhost:1717` for the redirect, the command accepts the redirect URL from stdin. No HTTP server is started.

There are about 150 lines of source: `src/commands/org/login/remote.ts` (the command) and `src/remoteLogin.ts` (session creation and callback validation).

## Why not Device Flow or JWT

| | Device Flow (`org login device`, removed) | JWT (`org login jwt`) | This plugin |
| --- | --- | --- | --- |
| Human logs in interactively with SSO and MFA | yes | no | yes |
| Works with the built-in connected app | no longer (disabled by Salesforce in 2025, see forcedotcom/cli#3368) | no (needs your own connected app, certificate and pre-authorized profiles) | yes |
| Needs setup before the first login | no | yes, per org | no |
| Needs a browser on the CLI machine | no | no | no |
| OAuth flow | device authorization grant | JWT bearer | authorization code + PKCE (same as `org login web`) |

JWT is the right tool for unattended automation. It is not a replacement for "a developer wants to give an agent access to an org they have not set anything up for yet".

## Security notes

- PKCE and `state` are generated with `crypto.randomBytes`. The code verifier never leaves the process and is never printed.
- Access tokens, refresh tokens and the pasted callback URL are never printed. The prompt is masked. `--json` output redacts tokens.
- The authorization code is only held in memory and removed from the config object after the exchange. It is single use and short lived on the Salesforce side; the PKCE verifier makes it useless to anyone who sees it without the running process.
- Exact-match checks on the callback origin and path, constant-time comparison of `state`, OAuth `error` responses rejected before any exchange.
- Replayed or expired codes fail at the token endpoint and are reported with a message that tells you to run the command again.
- Tokens are stored only through `@salesforce/core` (`AuthInfo.save`). Nothing else is written to disk.

What you should still think about:

- The redirect URL contains the authorization code. Paste it straight into the terminal. If you relay it to an agent through a chat tool, that chat now contains a single-use, PKCE-bound code; it is useless without the verifier held by the waiting process, but treat it like any other secret and do not store it.
- Refresh tokens from the built-in connected app are stored in the CLI's auth files on the headless machine, exactly as with `org login web`. Salesforce announced a 30-day idle timeout for these tokens starting 2026-11-09 (forcedotcom/cli#3668).
- The command does not bypass any Salesforce control. Login, SSO, MFA, IP restrictions and connected-app policies apply unchanged, because the browser session is a normal Salesforce login.

## Limitations

- You have to copy a long URL from a browser by hand. On a phone that is a few taps, but it is manual.
- The browser shows a "cannot connect to server" page after login. That is expected and documented, but it looks like an error to someone who has not read the instructions.
- Only the built-in `PlatformCLI` connected app is wired up. A `--client-id` flag could be added easily but was left out to keep the proof of concept small.
- The `state` check only proves the pasted URL belongs to this process. Someone with access to your terminal session can paste a URL from their own login, which is the same trust model as the local callback server in `org login web`.

## Verified environments

See [VERIFICATION.md](VERIFICATION.md) for the exact runs. Summary:

- Unit tests: macOS (Node 26) and GitHub Actions Ubuntu (Node 20, 22).
- Plugin installation into `sf` from this git repository: GitHub Actions Ubuntu.
- Headless Linux end-to-end login: Docker `node:22-bookworm-slim` container, no `DISPLAY`, no browser, with the login completed on an iPhone in Safari.

## Development

```bash
npm install
npm test          # mocha unit tests (OAuth exchange is mocked)
npm run lint
npm run typecheck
npm run build     # tsc + oclif manifest
sf plugins link . # try it in your local sf
```

## Upstream proposal

The matching feature request for the official CLI (`sf org login web --manual` or similar) is tracked in forcedotcom/cli. The issue link is added here once it is filed.

## License

MIT
