/**
 * The Launch stack link (AWS connect PR D2): the server switch, the template
 * configuration checks, the documented quick-create URL, and log lines that
 * name variables but never values. Pure; no AWS, no network. Placeholders only.
 */
import {
  buildLaunchStackUrl,
  isTemplateUrlFor,
  launchStackFor,
  launchStackStateLine,
  readLaunchStackConfig,
  resetLaunchStackWarnings,
} from '../launch-stack';

const TEMPLATE_URL = 'https://template-bucket.s3.us-east-1.amazonaws.com/cloudformation/devcontrol-role/v1/devcontrol-role.v1.json';
const EXTERNAL_ID = 'AbCdEfGhIjKlMnOpQrStUvWxYz012345';
const VALID = {
  CONNECT_LAUNCH_STACK_ENABLED: 'true',
  CONNECT_TEMPLATE_URL: TEMPLATE_URL,
  CONNECT_TEMPLATE_VERSION: '1',
} as unknown as NodeJS.ProcessEnv;

let warn: jest.SpyInstance;
beforeEach(() => {
  resetLaunchStackWarnings();
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

/** The query string inside the console URL's fragment, parsed the way a browser would. */
function fragmentParams(url: string): URLSearchParams {
  const fragment = new URL(url).hash;
  return new URLSearchParams(fragment.slice(fragment.indexOf('?') + 1));
}

describe('LS1 the quick-create link (documented format)', () => {
  it('is exactly the documented form for us-east-1', () => {
    expect(launchStackFor(EXTERNAL_ID, VALID)).toEqual({
      url: 'https://us-east-1.console.aws.amazon.com/cloudformation/home?region=us-east-1#/stacks/create/review'
        + '?templateURL=https%3A%2F%2Ftemplate-bucket.s3.us-east-1.amazonaws.com%2Fcloudformation%2Fdevcontrol-role%2Fv1%2Fdevcontrol-role.v1.json'
        + `&stackName=DevControl&param_ExternalId=${EXTERNAL_ID}&param_RoleName=DevControlRole`,
      templateVersion: '1',
      templateUrl: TEMPLATE_URL,
    });
  });

  it('uses the configured Region in the host and the region parameter', () => {
    const link = launchStackFor(EXTERNAL_ID, { ...VALID, CONNECT_LAUNCH_STACK_REGION: 'eu-west-2' })!;
    const url = new URL(link.url);
    expect(url.hostname).toBe('eu-west-2.console.aws.amazon.com');
    expect(url.pathname).toBe('/cloudformation/home');
    expect(url.searchParams.get('region')).toBe('eu-west-2');
  });

  it('builds the same link through the pure builder', () => {
    expect(buildLaunchStackUrl({ region: 'us-east-1', templateUrl: TEMPLATE_URL, externalId: EXTERNAL_ID })).toBe(launchStackFor(EXTERNAL_ID, VALID)!.url);
  });
});

describe('LS2 values survive the round trip', () => {
  it.each([EXTERNAL_ID, 'legacy+id=with,all.the@chars:a/b_c-d', 'a+b', 'x/y'])('recovers External ID %s and the template URL exactly', (externalId) => {
    const params = fragmentParams(launchStackFor(externalId, VALID)!.url);
    expect(params.get('param_ExternalId')).toBe(externalId);
    expect(params.get('templateURL')).toBe(TEMPLATE_URL);
    expect(params.get('stackName')).toBe('DevControl');
    expect(params.get('param_RoleName')).toBe('DevControlRole');
    expect([...params.keys()]).toEqual(['templateURL', 'stackName', 'param_ExternalId', 'param_RoleName']);
  });

  it('a malformed External ID gets no link', () => {
    expect(launchStackFor('bad id', VALID)).toBeNull();
  });
});

describe('LS3 off unless everything is valid', () => {
  it.each([
    ['the switch unset', { CONNECT_LAUNCH_STACK_ENABLED: undefined }],
    ['the switch "TRUE"', { CONNECT_LAUNCH_STACK_ENABLED: 'TRUE' }],
    ['the switch "1"', { CONNECT_LAUNCH_STACK_ENABLED: '1' }],
    ['the switch " true"', { CONNECT_LAUNCH_STACK_ENABLED: ' true' }],
    ['the switch "false"', { CONNECT_LAUNCH_STACK_ENABLED: 'false' }],
    ['no template URL', { CONNECT_TEMPLATE_URL: undefined }],
    ['no template version', { CONNECT_TEMPLATE_VERSION: undefined }],
    ['an unpublished version', { CONNECT_TEMPLATE_VERSION: '2' }],
    ['an inherited property as a version', { CONNECT_TEMPLATE_VERSION: 'constructor' }],
    ['a bad Region', { CONNECT_LAUNCH_STACK_REGION: 'us-east-1.evil.test' }],
    ['an empty Region', { CONNECT_LAUNCH_STACK_REGION: '' }],
  ])('no link with %s', (_label, change) => {
    expect(launchStackFor(EXTERNAL_ID, { ...VALID, ...change } as NodeJS.ProcessEnv)).toBeNull();
  });

  it.each([
    ['http', TEMPLATE_URL.replace('https:', 'http:')],
    ['the legacy s3-<region> host', 'https://s3-us-east-1.amazonaws.com/template-bucket/cloudformation/devcontrol-role/v1/devcontrol-role.v1.json'],
    ['a foreign host', 'https://templates.example.com/cloudformation/devcontrol-role/v1/devcontrol-role.v1.json'],
    ['a look-alike host', 'https://template-bucket.s3.us-east-1.amazonaws.com.evil.test/cloudformation/devcontrol-role/v1/devcontrol-role.v1.json'],
    ['a query (presigned)', `${TEMPLATE_URL}?X-Amz-Signature=abc`],
    ['a fragment', `${TEMPLATE_URL}#x`],
    ['credentials', 'https://user:pass@template-bucket.s3.us-east-1.amazonaws.com/cloudformation/devcontrol-role/v1/devcontrol-role.v1.json'],
    ['a port', 'https://template-bucket.s3.us-east-1.amazonaws.com:8443/cloudformation/devcontrol-role/v1/devcontrol-role.v1.json'],
    ['a path without the version', 'https://template-bucket.s3.us-east-1.amazonaws.com/cloudformation/devcontrol-role/devcontrol-role.v1.json'],
    ['another version\'s path', 'https://template-bucket.s3.us-east-1.amazonaws.com/cloudformation/devcontrol-role/v2/devcontrol-role.v2.json'],
    ['a non-JSON file', 'https://template-bucket.s3.us-east-1.amazonaws.com/cloudformation/devcontrol-role/v1/devcontrol-role.v1.yaml'],
    ['an encoded path', 'https://template-bucket.s3.us-east-1.amazonaws.com/cloudformation/devcontrol-role/v1/devcontrol%2Drole.v1.json'],
    ['dot segments', 'https://template-bucket.s3.us-east-1.amazonaws.com/x/../cloudformation/devcontrol-role/v1/devcontrol-role.v1.json'],
    ['an upper-case host', 'https://TEMPLATE-BUCKET.s3.us-east-1.amazonaws.com/cloudformation/devcontrol-role/v1/devcontrol-role.v1.json'],
    ['path style without a key', 'https://s3.us-east-1.amazonaws.com/template-bucket'],
    ['javascript:', 'javascript:alert(1)//s3.us-east-1.amazonaws.com/v1/a.json'],
    ['too long', `https://template-bucket.s3.us-east-1.amazonaws.com/v1/${'a'.repeat(1100)}.json`],
  ])('no link with a template URL that has %s', (_label, url) => {
    expect(isTemplateUrlFor(url, '1')).toBe(false);
    expect(launchStackFor(EXTERNAL_ID, { ...VALID, CONNECT_TEMPLATE_URL: url })).toBeNull();
  });

  it('accepts both documented S3 forms', () => {
    expect(isTemplateUrlFor(TEMPLATE_URL, '1')).toBe(true);
    expect(isTemplateUrlFor('https://s3.us-east-1.amazonaws.com/template-bucket/cloudformation/devcontrol-role/v1/devcontrol-role.v1.json', '1')).toBe(true);
  });
});

describe('LS4 log lines name the variable, never its value', () => {
  it('warns once per distinct problem set, without the URL, the External ID or the version value', () => {
    const env = { ...VALID, CONNECT_TEMPLATE_URL: `${TEMPLATE_URL}?X-Amz-Signature=secretish` };
    launchStackFor(EXTERNAL_ID, env);
    launchStackFor(EXTERNAL_ID, env);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toBe('[connect] Launch stack is off: invalid or missing CONNECT_TEMPLATE_URL');
    expect(line).not.toContain('template-bucket');
    expect(line).not.toContain(EXTERNAL_ID);

    launchStackFor(EXTERNAL_ID, { ...VALID, CONNECT_TEMPLATE_VERSION: '9' });
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[1][0])).toBe('[connect] Launch stack is off: invalid or missing CONNECT_TEMPLATE_VERSION, CONNECT_TEMPLATE_URL');
  });

  it('does not warn when the feature is simply off', () => {
    expect(launchStackFor(EXTERNAL_ID, {} as NodeJS.ProcessEnv)).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('LS5 the startup line', () => {
  it.each([
    ['nothing set', {}, '[connect] Launch stack: off'],
    ['switch "false", nothing else', { CONNECT_LAUNCH_STACK_ENABLED: 'false' }, '[connect] Launch stack: off'],
    ['template configured, switch unset', { CONNECT_TEMPLATE_URL: TEMPLATE_URL, CONNECT_TEMPLATE_VERSION: '1' }, '[connect] Launch stack: off (template v1 configured)'],
    ['ready', VALID, '[connect] Launch stack: ready (template v1)'],
    ['switch typo', { CONNECT_LAUNCH_STACK_ENABLED: 'yes' }, '[connect] Launch stack: misconfigured (CONNECT_LAUNCH_STACK_ENABLED)'],
    ['URL invalid, switch unset', { CONNECT_TEMPLATE_URL: 'http://x', CONNECT_TEMPLATE_VERSION: '1' }, '[connect] Launch stack: misconfigured (CONNECT_TEMPLATE_URL)'],
    ['switch on, nothing else', { CONNECT_LAUNCH_STACK_ENABLED: 'true' }, '[connect] Launch stack: misconfigured (CONNECT_TEMPLATE_VERSION, CONNECT_TEMPLATE_URL)'],
    ['bad Region', { ...VALID, CONNECT_LAUNCH_STACK_REGION: 'mars' }, '[connect] Launch stack: misconfigured (CONNECT_LAUNCH_STACK_REGION)'],
  ])('%s', (_label, env, line) => {
    expect(launchStackStateLine(env as NodeJS.ProcessEnv)).toBe(line);
  });

  it('never contains a configured value', () => {
    const line = launchStackStateLine({ ...VALID, CONNECT_LAUNCH_STACK_REGION: 'eu-west-2' });
    expect(line).not.toContain('template-bucket');
    expect(line).not.toContain('eu-west-2');
  });

  it('readLaunchStackConfig reads process.env by default', () => {
    expect(readLaunchStackConfig().state).toBe('off');
  });
});

describe('LS6 the configured version must implement the running permission contract', () => {
  it('a build whose contract moved past v1 refuses to offer template v1', () => {
    jest.isolateModules(() => {
      jest.doMock('../connect-policy-compare', () => ({
        ...jest.requireActual('../connect-policy-compare'),
        CUSTOMER_ROLE_CONTRACT_VERSION: 2,
      }));
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const template = require('../customer-role-template') as typeof import('../customer-role-template');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const launch = require('../launch-stack') as typeof import('../launch-stack');
      expect(template.isOfferableTemplateVersion('1')).toBe(false);
      expect(launch.launchStackFor(EXTERNAL_ID, VALID)).toBeNull();
      expect(launch.launchStackStateLine(VALID)).toBe('[connect] Launch stack: misconfigured (CONNECT_TEMPLATE_VERSION, CONNECT_TEMPLATE_URL)');
    });
    jest.dontMock('../connect-policy-compare');
  });

  it('the running build offers v1', () => {
    expect(launchStackFor(EXTERNAL_ID, VALID)).not.toBeNull();
  });
});
