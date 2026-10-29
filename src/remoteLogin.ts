import { randomBytes, timingSafeEqual } from 'node:crypto';
import { OAuth2 } from '@jsforce/jsforce-node';
import { AuthInfo, Messages, OAuth2Config, SfError } from '@salesforce/core';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-plugin-remote-login', 'remote.login');

/** Subset of core's (unexported) JwtOAuth2Config that the auth code flow needs. */
export type RemoteOAuthConfig = OAuth2Config & { state: string; authCode?: string };

/** Client id of the CLI's built-in connected app (same as `sf org login web`). */
export const DEFAULT_CLIENT_ID = 'PlatformCLI';

export type RemoteLoginSession = {
  /** Full Salesforce authorization URL (PKCE challenge + state included). Safe to print. */
  authUrl: string;
  /** Config to pass to AuthInfo.create as oauth2Options once authCode is set. */
  oauthConfig: RemoteOAuthConfig;
  /** Holds the PKCE code verifier. Pass to AuthInfo.create as oauth2. Never log. */
  oauth2: OAuth2;
};

/** Builds an Authorization Code + PKCE request using the same core helpers as `sf org login web`. */
export function createSession(options: {
  loginUrl: string;
  redirectUri: string;
  clientId?: string;
}): RemoteLoginSession {
  const oauthConfig: RemoteOAuthConfig = {
    loginUrl: options.loginUrl,
    clientId: options.clientId ?? DEFAULT_CLIENT_ID,
    redirectUri: options.redirectUri,
    useVerifier: true,
    state: randomBytes(32).toString('hex'),
  };
  // jsforce generates the PKCE verifier in the OAuth2 constructor; keep this instance for the token exchange.
  const oauth2 = new OAuth2(oauthConfig);
  const authUrl = AuthInfo.getAuthorizationUrl(oauthConfig, oauth2);
  return { authUrl, oauthConfig, oauth2 };
}

/**
 * Validates a pasted callback URL and returns the authorization code.
 * Throws SfError with names: EmptyCallbackUrlError, MalformedCallbackUrlError, UnexpectedRedirectUriError,
 * StateMismatchError, OAuthError, MissingAuthCodeError.
 */
export function parseCallbackUrl(input: string, expected: { redirectUri: string; state: string }): string {
  const trimmed = input.trim();
  if (!trimmed) throw messages.createError('error.emptyCallbackUrl');

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw messages.createError('error.malformedCallbackUrl');
  }

  const expectedUrl = new URL(expected.redirectUri);
  if (url.origin !== expectedUrl.origin || url.pathname !== expectedUrl.pathname) {
    throw messages.createError('error.unexpectedRedirectUri', [expectedUrl.origin + expectedUrl.pathname]);
  }

  const state = url.searchParams.get('state') ?? '';
  if (!state || !safeEqual(state, expected.state)) throw messages.createError('error.stateMismatch');

  const error = url.searchParams.get('error');
  if (error) {
    throw new SfError(sanitize(url.searchParams.get('error_description') ?? error), 'OAuthError');
  }

  const code = url.searchParams.get('code');
  if (!code) throw messages.createError('error.missingAuthCode');
  return code;
}

/** Error text comes from the pasted URL: drop control characters and cap the length before printing it. */
const sanitize = (text: string): string =>
  // eslint-disable-next-line no-control-regex
  text.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 300);

const safeEqual = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
};
