import { Flags, SfCommand, loglevel } from '@salesforce/sf-plugins-core';
import { AuthFields, AuthInfo, Messages, SfdcUrl, SfError, WebOAuthServer } from '@salesforce/core';
import { createSession, parseCallbackUrl } from '../../../remoteLogin.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sf-plugin-remote-login', 'remote.login');

export default class LoginRemote extends SfCommand<AuthFields> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');

  public static readonly flags = {
    'instance-url': Flags.url({
      char: 'r',
      summary: messages.getMessage('flags.instance-url.summary'),
      description: messages.getMessage('flags.instance-url.description'),
    }),
    'set-default-dev-hub': Flags.boolean({
      char: 'd',
      summary: messages.getMessage('flags.set-default-dev-hub.summary'),
    }),
    'set-default': Flags.boolean({
      char: 's',
      summary: messages.getMessage('flags.set-default.summary'),
    }),
    alias: Flags.string({
      char: 'a',
      summary: messages.getMessage('flags.alias.summary'),
    }),
    timeout: Flags.integer({
      summary: messages.getMessage('flags.timeout.summary'),
      default: 15,
      min: 1,
    }),
    loglevel,
  };

  public async run(): Promise<AuthFields> {
    const { flags } = await this.parse(LoginRemote);

    const loginUrl = flags['instance-url']?.href ?? AuthInfo.getDefaultInstanceUrl();
    if (new SfdcUrl(loginUrl).isLightningDomain()) {
      throw messages.createError('error.lightningInstanceUrl');
    }
    const port = await WebOAuthServer.determineOauthPort();
    const redirectUri = `http://localhost:${port}/OauthRedirect`;
    const session = createSession({ loginUrl, redirectUri });

    this.log(messages.getMessage('instructions.open'));
    this.log('');
    this.log(session.authUrl);
    this.log('');
    this.log(messages.getMessage('instructions.paste', [redirectUri]));

    // Hidden input: the callback URL carries the single-use authorization code.
    let pasted: string;
    try {
      pasted = await this.secretPrompt({
        message: messages.getMessage('prompt.callbackUrl'),
        ms: flags.timeout * 60_000,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'ExitPromptError') {
        throw messages.createError('error.cancelled');
      }
      throw messages.createError('error.timeout', [flags.timeout]);
    }

    session.oauthConfig.authCode = parseCallbackUrl(pasted, { redirectUri, state: session.oauthConfig.state });

    let authInfo: AuthInfo;
    try {
      authInfo = await AuthInfo.create({ oauth2Options: session.oauthConfig, oauth2: session.oauth2 });
    } catch (err) {
      if (err instanceof SfError && err.name === 'AuthCodeExchangeError') {
        throw messages.createError('error.authCodeExchange', [err.message], [], err);
      }
      throw err;
    } finally {
      delete session.oauthConfig.authCode;
    }

    await authInfo.save();
    await authInfo.handleAliasAndDefaultSettings({
      alias: flags.alias,
      setDefault: flags['set-default'],
      setDefaultDevHub: flags['set-default-dev-hub'],
    });
    const fields = authInfo.getFields(true);
    await AuthInfo.identifyPossibleScratchOrgs(fields, authInfo);

    this.logSuccess(messages.getMessage('success', [fields.username, fields.orgId]));
    return { ...fields, accessToken: undefined, refreshToken: undefined, clientSecret: undefined };
  }
}
