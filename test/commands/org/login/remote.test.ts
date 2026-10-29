import { expect } from 'chai';
import sinon from 'sinon';
import { AuthInfo, SfError, WebOAuthServer } from '@salesforce/core';
import { TestContext, MockTestOrgData } from '@salesforce/core/testSetup';
import { SfCommand, stubSfCommandUx } from '@salesforce/sf-plugins-core';
import LoginRemote from '../../../../src/commands/org/login/remote.js';

const redirectUri = 'http://localhost:1717/OauthRedirect';

describe('org login remote', () => {
  const $$ = new TestContext();
  const testOrg = new MockTestOrgData();
  let uxStubs: ReturnType<typeof stubSfCommandUx>;
  let secretPrompt: sinon.SinonStub;
  let authInfoCreate: sinon.SinonStub;
  let exchangedCode: string | undefined;
  let authInfo: { save: sinon.SinonStub; handleAliasAndDefaultSettings: sinon.SinonStub; getFields: sinon.SinonStub };

  /** Reads the state from the printed authorization URL so the test can craft a matching callback. */
  const printedAuthUrl = (): URL => {
    const line = uxStubs.log.args.map((a) => a[0]).find((l) => typeof l === 'string' && l.startsWith('https://'));
    expect(line, 'authorization URL should be printed').to.be.a('string');
    return new URL(line as string);
  };

  const answerWithValidCallback = (code = 'aPrxCode'): void => {
    secretPrompt.callsFake(async () => {
      const state = printedAuthUrl().searchParams.get('state');
      return `${redirectUri}?code=${code}&state=${state}`;
    });
  };

  const runAndCatch = async (args: string[] = []): Promise<SfError> => {
    try {
      await LoginRemote.run(args);
    } catch (err) {
      return err as SfError;
    }
    throw new Error('expected command to throw');
  };

  beforeEach(async () => {
    await $$.stubAuths(testOrg);
    uxStubs = stubSfCommandUx($$.SANDBOX);
    secretPrompt = $$.SANDBOX.stub(SfCommand.prototype, 'secretPrompt');
    $$.SANDBOX.stub(WebOAuthServer, 'determineOauthPort').resolves(1717);
    authInfo = {
      save: $$.SANDBOX.stub().resolves(),
      handleAliasAndDefaultSettings: $$.SANDBOX.stub().resolves(),
      getFields: $$.SANDBOX.stub().returns({
        username: testOrg.username,
        orgId: testOrg.orgId,
        instanceUrl: testOrg.instanceUrl,
        accessToken: 'ACCESS',
        refreshToken: 'REFRESH',
        clientSecret: '',
      }),
    };
    exchangedCode = undefined;
    authInfoCreate = $$.SANDBOX.stub(AuthInfo, 'create').callsFake(async (options?: AuthInfo.Options) => {
      // the command clears authCode after the exchange, so capture it at call time
      exchangedCode = options?.oauth2Options?.authCode;
      return authInfo as unknown as AuthInfo;
    });
    $$.SANDBOX.stub(AuthInfo, 'identifyPossibleScratchOrgs').resolves();
  });

  afterEach(() => {
    $$.restore();
  });

  it('prints the authorization URL, exchanges the pasted code and saves the auth with alias and defaults', async () => {
    answerWithValidCallback('theCode');
    const result = await LoginRemote.run(['--alias', 'dev', '--set-default']);

    const authUrl = printedAuthUrl();
    expect(authUrl.origin).to.equal('https://login.salesforce.com');
    expect(authUrl.searchParams.get('code_challenge')).to.have.length(43);
    expect(authUrl.searchParams.get('redirect_uri')).to.equal(redirectUri);

    expect(authInfoCreate.calledOnce).to.be.true;
    const options = authInfoCreate.firstCall.args[0] as AuthInfo.Options;
    expect(exchangedCode).to.equal('theCode');
    expect(options.oauth2Options?.authCode, 'auth code is cleared after the exchange').to.be.undefined;
    expect(options.oauth2Options?.clientId).to.equal('PlatformCLI');
    expect(options.oauth2Options?.redirectUri).to.equal(redirectUri);
    expect(options.oauth2, 'the OAuth2 instance holding the PKCE verifier must be reused').to.exist;

    expect(authInfo.save.calledOnce).to.be.true;
    const sideEffects = authInfo.handleAliasAndDefaultSettings.firstCall.args[0] as Record<string, unknown>;
    expect(sideEffects).to.include({ alias: 'dev', setDefault: true });
    expect(sideEffects.setDefaultDevHub).to.not.be.ok;
    expect(uxStubs.logSuccess.firstCall.args[0]).to.include(testOrg.username);
    expect(result.username).to.equal(testOrg.username);
    expect(result.accessToken).to.be.undefined;
    expect(result.refreshToken).to.be.undefined;
  });

  it('never echoes the pasted callback URL, tokens or the PKCE verifier', async () => {
    answerWithValidCallback('secretCode');
    await LoginRemote.run([]);
    const verifier = (authInfoCreate.firstCall.args[0] as { oauth2: { codeVerifier: string } }).oauth2.codeVerifier;
    const everything = [...uxStubs.log.args, ...uxStubs.logSuccess.args, ...uxStubs.warn.args]
      .map((a) => (typeof a[0] === 'string' ? a[0] : JSON.stringify(a[0])))
      .join('\n');
    expect(everything).to.not.include('secretCode');
    expect(everything).to.not.include(verifier);
    expect(everything).to.not.include('ACCESS');
    expect(everything).to.not.include('REFRESH');
  });

  it('uses --instance-url for the authorization URL', async () => {
    answerWithValidCallback();
    await LoginRemote.run(['--instance-url', 'https://test.salesforce.com']);
    expect(printedAuthUrl().origin).to.equal('https://test.salesforce.com');
    expect((authInfoCreate.firstCall.args[0] as AuthInfo.Options).oauth2Options?.loginUrl).to.equal(
      'https://test.salesforce.com/',
    );
  });

  it('rejects lightning domains as --instance-url', async () => {
    const err = await runAndCatch(['--instance-url', 'https://foo.lightning.force.com']);
    expect(err.name).to.equal('LightningInstanceUrlError');
    expect(secretPrompt.called).to.be.false;
  });

  it('rejects a callback whose state does not match and does not exchange anything', async () => {
    secretPrompt.resolves(`${redirectUri}?code=x&state=${'f'.repeat(64)}`);
    const err = await runAndCatch();
    expect(err.name).to.equal('StateMismatchError');
    expect(authInfoCreate.called).to.be.false;
  });

  it('rejects a callback without a code', async () => {
    secretPrompt.callsFake(async () => `${redirectUri}?state=${printedAuthUrl().searchParams.get('state')}`);
    expect((await runAndCatch()).name).to.equal('MissingAuthCodeError');
    expect(authInfoCreate.called).to.be.false;
  });

  it('reports an OAuth error response from Salesforce', async () => {
    secretPrompt.callsFake(
      async () =>
        `${redirectUri}?error=access_denied&error_description=user+said+no&state=${printedAuthUrl().searchParams.get(
          'state',
        )}`,
    );
    const err = await runAndCatch();
    expect(err.name).to.equal('OAuthError');
    expect(err.message).to.include('user said no');
    expect(authInfoCreate.called).to.be.false;
  });

  it('rejects a malformed paste', async () => {
    secretPrompt.resolves('code=abc');
    expect((await runAndCatch()).name).to.equal('MalformedCallbackUrlError');
  });

  it('explains a replayed or expired authorization code and clears the code', async () => {
    answerWithValidCallback();
    authInfoCreate.rejects(
      SfError.create({ name: 'AuthCodeExchangeError', message: 'invalid_grant: expired authorization code' }),
    );
    const err = await runAndCatch();
    expect(err.name).to.equal('AuthCodeExchangeError');
    expect(err.message).to.include('single use');
    expect(err.message).to.include('expired authorization code');
    expect((authInfoCreate.firstCall.args[0] as AuthInfo.Options).oauth2Options?.authCode).to.be.undefined;
    expect(authInfo.save.called).to.be.false;
  });

  it('propagates network failures during the token exchange', async () => {
    answerWithValidCallback();
    authInfoCreate.rejects(
      Object.assign(new Error('getaddrinfo ENOTFOUND login.salesforce.com'), { code: 'ENOTFOUND' }),
    );
    const err = await runAndCatch();
    expect(err.message).to.include('ENOTFOUND');
    expect(authInfo.save.called).to.be.false;
  });

  it('fails with a timeout error when the prompt times out', async () => {
    secretPrompt.rejects(new Error('Prompt timed out after 60000 ms'));
    const err = await runAndCatch(['--timeout', '1']);
    expect(err.name).to.equal('TimeoutError');
    expect(err.message).to.include('1 minutes');
    expect(secretPrompt.firstCall.args[0]).to.deep.include({ ms: 60_000 });
    expect(authInfoCreate.called).to.be.false;
  });

  it('fails with a cancellation error when the user aborts the prompt', async () => {
    secretPrompt.rejects(Object.assign(new Error('User force closed the prompt'), { name: 'ExitPromptError' }));
    const err = await runAndCatch();
    expect(err.name).to.equal('CancelledError');
    expect(authInfoCreate.called).to.be.false;
  });
});
