# summary

Log in to a Salesforce org from a headless environment by pasting the OAuth callback URL.

# description

Prints the Salesforce authorization URL (Authorization Code flow with PKCE, same connected app as "org login web") and waits for you to paste the callback URL back. Open the URL in any browser on any device, complete the normal Salesforce login (including SSO and MFA), and when the browser lands on the "http://localhost:1717/OauthRedirect?code=..." page (it will fail to load, that is expected), copy the full address and paste it here. No browser, port forwarding, or open network port is needed on the machine running the CLI.

The authorization is saved exactly like "org login web", so all other CLI commands can use it afterward.

# examples

- Log in and set an alias:

  <%= config.bin %> <%= command.id %> --alias my-org

- Log in to a sandbox and make it the default org:

  <%= config.bin %> <%= command.id %> --instance-url https://test.salesforce.com --set-default

# flags.instance-url.summary

URL of the instance that the org lives on.

# flags.instance-url.description

Defaults to the "org-instance-url" config value, or https://login.salesforce.com. Use https://test.salesforce.com for sandboxes, or the My Domain login URL for SSO.

# flags.set-default-dev-hub.summary

Set the authenticated org as the default Dev Hub.

# flags.set-default.summary

Set the authenticated org as the default that all org-related commands run against.

# flags.alias.summary

Alias for the org.

# flags.timeout.summary

Minutes to wait for the pasted callback URL.

# instructions.open

Open this URL in any browser (phone, tablet, another computer):

# instructions.paste

Complete the login. The browser will then try to open %s and fail to load (this is expected). Copy the full address from the browser's address bar and paste it below. The input is hidden.

# prompt.callbackUrl

Callback URL

# success

Successfully authorized %s with org ID %s

# error.emptyCallbackUrl

No callback URL was entered.

# error.malformedCallbackUrl

The pasted value is not a valid URL. Paste the full address from the browser, starting with "http://localhost".

# error.unexpectedRedirectUri

The pasted URL does not start with the expected callback %s. Paste the address the browser landed on after login, not the authorization URL.

# error.stateMismatch

The "state" value in the callback URL does not match this login attempt. Run the command again and use the new URL it prints.

# error.missingAuthCode

The callback URL does not contain an authorization code.

# error.authCodeExchange

Salesforce rejected the authorization code: %s. Codes are single use and expire after a few minutes. Run the command again and paste the new callback URL right after logging in.

# error.timeout

Timed out after %s minutes waiting for the callback URL.

# error.cancelled

Login cancelled.

# error.lightningInstanceUrl

Lightning domains cannot be used as --instance-url. Use the My Domain login URL (https://<mydomain>.my.salesforce.com) instead.

# error.jsonNotSupported

This command is interactive and does not support --json. Run it without --json; the authorization is stored the same way and "org display --json" shows the result.
