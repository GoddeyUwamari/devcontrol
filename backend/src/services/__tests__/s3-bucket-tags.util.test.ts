/**
 * A bucket's tags are evidence only when they were read. NoSuchTagSet is AWS saying
 * the bucket has none; any other failure leaves them unknown; and a bucket outside
 * the home region is read in its own region rather than recorded as unknown.
 */
import { S3Client } from '@aws-sdk/client-s3';
import { getBucketTags, regionFromLocationConstraint } from '../s3-bucket-tags.util';

const awsError = (name: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(name), { name }, extra);

/** One client per region, each answering GetBucketTagging as given. Records which regions were asked. */
function regionalClients(answers: Record<string, () => unknown>) {
  const asked: string[] = [];
  const clientForRegion = (region: string) => {
    const client = new S3Client({ region });
    (client as any).send = jest.fn(async (command: any) => {
      expect(command.constructor.name).toBe('GetBucketTaggingCommand');
      asked.push(region);
      const answer = answers[region];
      if (!answer) throw new Error(`no answer set up for ${region}`);
      return answer();
    });
    return client;
  };
  return { asked, clientForRegion };
}

describe('getBucketTags', () => {
  it('returns the tag set AWS reports', async () => {
    const { clientForRegion } = regionalClients({
      'us-east-1': () => ({ TagSet: [{ Key: 'Owner', Value: 'platform' }, { Key: 'Team', Value: 'core' }] }),
    });
    expect(await getBucketTags(clientForRegion, 'app-prod-backups', 'us-east-1')).toEqual({
      state: 'observed', tags: { Owner: 'platform', Team: 'core' },
    });
  });

  it('keeps a tag whose value is empty: the bucket has that tag', async () => {
    const { clientForRegion } = regionalClients({ 'us-east-1': () => ({ TagSet: [{ Key: 'Owner', Value: '' }] }) });
    expect(await getBucketTags(clientForRegion, 'app-prod-backups', 'us-east-1')).toEqual({ state: 'observed', tags: { Owner: '' } });
  });

  it('NoSuchTagSet is evidence of zero tags', async () => {
    const { clientForRegion } = regionalClients({ 'us-east-1': () => { throw awsError('NoSuchTagSet'); } });
    expect(await getBucketTags(clientForRegion, 'app-prod-backups', 'us-east-1')).toEqual({ state: 'observed', tags: {} });
  });

  it.each([
    ['AccessDenied', awsError('AccessDenied', { $metadata: { httpStatusCode: 403 } })],
    ['throttling', awsError('SlowDown', { $metadata: { httpStatusCode: 503 } })],
    ['a network failure', new Error('socket hang up')],
    ['NoSuchBucket', awsError('NoSuchBucket', { $metadata: { httpStatusCode: 404 } })],
  ])('%s leaves the tags unknown, never empty', async (_name, error) => {
    const { clientForRegion } = regionalClients({ 'us-east-1': () => { throw error; } });
    const result = await getBucketTags(clientForRegion, 'app-prod-backups', 'us-east-1');
    expect(result.state).toBe('unavailable');
    expect(result).not.toHaveProperty('tags');
  });

  it('never puts the error text in the result: only its name', async () => {
    const { clientForRegion } = regionalClients({
      'us-east-1': () => { throw awsError('AccessDenied', { message: 'User arn:aws:sts::111122223333:assumed-role/x is not authorized' }); },
    });
    expect(await getBucketTags(clientForRegion, 'app-prod-backups', 'us-east-1')).toEqual({ state: 'unavailable', reason: 'AccessDenied' });
  });

  describe('a bucket outside the home region', () => {
    it('is read with a client for its own region when that region is known', async () => {
      const { asked, clientForRegion } = regionalClients({ 'eu-west-1': () => ({ TagSet: [{ Key: 'Owner', Value: 'web' }] }) });
      expect(await getBucketTags(clientForRegion, 'marketing-site', 'eu-west-1')).toEqual({ state: 'observed', tags: { Owner: 'web' } });
      expect(asked).toEqual(['eu-west-1']);
    });

    it.each([
      ['PermanentRedirect (301)', awsError('PermanentRedirect', { $metadata: { httpStatusCode: 301 }, $response: { headers: { 'x-amz-bucket-region': 'eu-west-1' } } })],
      ['an unnamed 301', awsError('Unknown', { $metadata: { httpStatusCode: 301 }, $response: { headers: { 'x-amz-bucket-region': 'eu-west-1' } } })],
      ['AuthorizationHeaderMalformed', awsError('AuthorizationHeaderMalformed', { $metadata: { httpStatusCode: 400 }, Region: 'eu-west-1' })],
      ['IllegalLocationConstraintException', awsError('IllegalLocationConstraintException', { BucketRegion: 'eu-west-1' })],
    ])('a wrong-region answer (%s) is followed to the region S3 names, and the tags are read there', async (_name, redirect) => {
      const { asked, clientForRegion } = regionalClients({
        'us-east-1': () => { throw redirect; },
        'eu-west-1': () => ({ TagSet: [{ Key: 'Owner', Value: 'web' }] }),
      });
      expect(await getBucketTags(clientForRegion, 'marketing-site', 'us-east-1')).toEqual({ state: 'observed', tags: { Owner: 'web' } });
      expect(asked).toEqual(['us-east-1', 'eu-west-1']);
    });

    it('NoSuchTagSet from the bucket\'s own region, after a redirect, is zero tags', async () => {
      const { clientForRegion } = regionalClients({
        'us-east-1': () => { throw awsError('PermanentRedirect', { $response: { headers: { 'x-amz-bucket-region': 'ap-southeast-2' } } }); },
        'ap-southeast-2': () => { throw awsError('NoSuchTagSet'); },
      });
      expect(await getBucketTags(clientForRegion, 'marketing-site', 'us-east-1')).toEqual({ state: 'observed', tags: {} });
    });

    it('AccessDenied from the bucket\'s own region, after a redirect, is unknown', async () => {
      const { clientForRegion } = regionalClients({
        'us-east-1': () => { throw awsError('PermanentRedirect', { $response: { headers: { 'x-amz-bucket-region': 'eu-west-1' } } }); },
        'eu-west-1': () => { throw awsError('AccessDenied'); },
      });
      expect(await getBucketTags(clientForRegion, 'marketing-site', 'us-east-1')).toEqual({ state: 'unavailable', reason: 'AccessDenied' });
    });

    it('follows one redirect only', async () => {
      const redirectTo = (region: string) => () => { throw awsError('PermanentRedirect', { $response: { headers: { 'x-amz-bucket-region': region } } }); };
      const { asked, clientForRegion } = regionalClients({ 'us-east-1': redirectTo('eu-west-1'), 'eu-west-1': redirectTo('eu-central-1') });
      expect((await getBucketTags(clientForRegion, 'marketing-site', 'us-east-1')).state).toBe('unavailable');
      expect(asked).toEqual(['us-east-1', 'eu-west-1']);
    });

    it('a redirect that names no region cannot be followed: unknown', async () => {
      const { asked, clientForRegion } = regionalClients({ 'us-east-1': () => { throw awsError('PermanentRedirect', { $metadata: { httpStatusCode: 301 } }); } });
      expect(await getBucketTags(clientForRegion, 'marketing-site', 'us-east-1')).toEqual({ state: 'unavailable', reason: 'PermanentRedirect' });
      expect(asked).toEqual(['us-east-1']);
    });
  });
});

describe('regionFromLocationConstraint', () => {
  it.each([[undefined, 'us-east-1'], [null, 'us-east-1'], ['', 'us-east-1'], ['EU', 'eu-west-1'], ['eu-west-1', 'eu-west-1'], ['ap-southeast-2', 'ap-southeast-2']])(
    '%p is %s', (constraint, region) => {
      expect(regionFromLocationConstraint(constraint as any)).toBe(region);
    }
  );
});
