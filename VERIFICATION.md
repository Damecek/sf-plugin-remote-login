# Verification log

What was actually run, where, and what came out. Usernames, org IDs, codes and tokens are left out on purpose.

## 1. Automated checks (macOS, Node 26, 2026-10-29)

```text
npm run lint        eslint src test                      clean
npm run typecheck   tsc -p . --noEmit && tsc -p test     clean
npm test            mocha                                24 passing
npm run build       tsc + oclif manifest                 ok
```

Unit tests cover: authorization URL generation (PKCE challenge, state, client id, redirect URI, scopes), fresh state and verifier per session, the verifier never appearing in the URL, the jsforce `OAuth2` class identity check (guards the `instanceof` branch in `AuthInfo`), valid callback parsing, whitespace trimming, empty, malformed, wrong origin, wrong port, wrong path, missing state, mismatched state, OAuth error responses with and without description, missing code, alias and default-org side effects, redaction of tokens in output, expired or replayed code (mapped `AuthCodeExchangeError`), network failure during the exchange, prompt timeout, prompt cancellation, and rejection of Lightning domains as `--instance-url`.

The OAuth token exchange is mocked in unit tests. No real tokens are used or committed.

## 2. Installation into Salesforce CLI

- `sf plugins link .` on macOS with `@salesforce/cli` 2.156.8: `sf org login remote --help` works and `sf commands --json` lists `org:login:remote`.
- `echo y | sf plugins install https://github.com/Damecek/sf-plugin-remote-login.git#<sha>` inside Docker `node:22-bookworm-slim` (see `verification/Dockerfile`): install succeeds (the `prepare` script builds the plugin), `sf plugins` lists it, `--help` works.
- The same git install runs in GitHub Actions (`install-into-sf` job) on every push.

## 3. Headless Linux end-to-end login (2026-10-29)

Environment: Docker container from `verification/Dockerfile`, `node:22-bookworm-slim`, Linux aarch64, `DISPLAY` unset, no X socket, no `xdg-open`, `chromium`, `firefox` or `google-chrome` binaries. The command was started under `script` (a pseudo-terminal, as an SSH session would provide) by a small driver (`verification/driver.mjs`) that wrote the printed URL to a file and later fed the callback URL into the hidden prompt. Nothing else on the machine was reachable from the phone.

Steps:

1. `sf org login remote --alias remote-test --timeout 240` printed the authorization URL and waited.
2. The URL was opened in Safari on an iPhone (iOS, same account as the author). Login was a normal Salesforce username/password login to a production org (`login.salesforce.com`, My Domain org).
3. Safari was redirected to `http://localhost:1717/OauthRedirect?code=...&state=...` and showed "Safari cannot open the page" (expected: `localhost` is the phone). The full address was copied from the address bar.
4. The copied URL was pasted into the waiting prompt.
5. Output: `Successfully authorized <username> with org ID <org id>`, exit code 0. Elapsed time between login and paste was under two minutes.

Follow-up commands in the same container, using only the stored authorization:

```text
sf org list auth                         lists the org, alias remote-test, Auth Method: web
sf org display --target-org remote-test  Connected Status: Connected, Client Id: PlatformCLI
sf data query --target-org remote-test --query "SELECT Id FROM User LIMIT 1"
                                         1 record retrieved
```

The auth file written by the plugin (`~/.sfdx/<username>.json`) has the same fields as one written by `sf org login web` (accessToken, instanceUrl, orgId, username, loginUrl, refreshToken, clientId, plus org metadata). No authorization code, PKCE verifier or callback URL is stored.

Cleanup: `sf org logout --target-org remote-test --no-prompt` revoked the token, and the container and committed image were deleted.

## 4. Not verified

- Android browsers, desktop browsers other than the ones used during development (Safari on macOS was used for the local smoke test of the error path only).
- SSO (SAML or OpenID Connect) logins. The flow is the standard web server flow, so SSO should behave as with `org login web`, but it was not exercised.
- Code Builder or other environments that override the redirect URI.
- Refresh token rotation and the upcoming 30-day idle timeout on `PlatformCLI` refresh tokens (forcedotcom/cli#3668). Those apply equally to `org login web`.
