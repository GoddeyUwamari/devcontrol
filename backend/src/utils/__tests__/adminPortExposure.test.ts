import {
  ADMIN_DB_PORTS,
  IngressRule,
  adminPortsCovered,
  describeRulePorts,
  evaluateNetworkExposure,
  internetSources,
  openAdminRules,
} from '../adminPortExposure';

const tcp = (from: number, to: number, extra: Partial<IngressRule> = {}): IngressRule => ({
  IpProtocol: 'tcp', FromPort: from, ToPort: to, IpRanges: [{ CidrIp: '0.0.0.0/0' }], ...extra,
});

describe('ADMIN_DB_PORTS', () => {
  it('is the agreed list of administrative and database ports', () => {
    expect([...ADMIN_DB_PORTS].sort((a, b) => a - b)).toEqual([22, 1433, 1521, 3306, 3389, 5432, 5601, 6379, 9200, 11211, 27017]);
  });
});

describe('adminPortsCovered: port ranges', () => {
  it.each(ADMIN_DB_PORTS.map((port) => [port]))('a single-port tcp rule on %i covers it', (port) => {
    expect(adminPortsCovered(tcp(port, port))).toEqual([port]);
  });

  it('0-65535 covers every listed port, 22 included', () => {
    expect(adminPortsCovered(tcp(0, 65535))).toEqual([...ADMIN_DB_PORTS]);
  });

  it.each([
    ['a range that starts on the port', 22, 80, [22]],
    ['a range that ends on the port', 1, 22, [22]],
    ['a range that contains it', 20, 25, [22]],
    ['a range that ends one below it', 1, 21, []],
    ['a range that starts one above it', 23, 100, []],
    ['a range spanning several', 3300, 5500, [3389, 3306, 5432]],
    ['443 only', 443, 443, []],
    ['80-443', 80, 443, []],
  ])('%s', (_name, from, to, expected) => {
    expect(adminPortsCovered(tcp(from as number, to as number))).toEqual(expected);
  });

  it('a udp rule is matched by port like a tcp one', () => {
    expect(adminPortsCovered({ IpProtocol: 'udp', FromPort: 11211, ToPort: 11211 })).toEqual([11211]);
  });

  it('protocol numbers 6 and 17 are tcp and udp', () => {
    expect(adminPortsCovered({ IpProtocol: '6', FromPort: 22, ToPort: 22 })).toEqual([22]);
    expect(adminPortsCovered({ IpProtocol: '17', FromPort: 22, ToPort: 22 })).toEqual([22]);
  });

  it('a tcp rule with no port range establishes nothing', () => {
    expect(adminPortsCovered({ IpProtocol: 'tcp' })).toEqual([]);
  });
});

describe('adminPortsCovered: protocols', () => {
  it('protocol -1 (all protocols) covers every listed port, with no port range given', () => {
    expect(adminPortsCovered({ IpProtocol: '-1' })).toEqual([...ADMIN_DB_PORTS]);
  });

  // For ICMP, FromPort/ToPort are the type and code, not ports.
  it.each([
    ['icmp with type/code 22', { IpProtocol: 'icmp', FromPort: 22, ToPort: 22 }],
    ['icmp with every type and code', { IpProtocol: 'icmp', FromPort: -1, ToPort: -1 }],
    ['icmp spanning 0-65535', { IpProtocol: 'icmp', FromPort: 0, ToPort: 65535 }],
    ['icmpv6', { IpProtocol: 'icmpv6', FromPort: 22, ToPort: 22 }],
    ['protocol 58 (icmpv6 by number)', { IpProtocol: '58', FromPort: 22, ToPort: 22 }],
    ['protocol 47 (gre)', { IpProtocol: '47', FromPort: 0, ToPort: 65535 }],
    ['no protocol', { FromPort: 22, ToPort: 22 }],
  ])('%s covers no port', (_name, rule) => {
    expect(adminPortsCovered(rule)).toEqual([]);
  });
});

describe('internetSources', () => {
  it('finds 0.0.0.0/0 and ::/0 and nothing narrower', () => {
    expect(internetSources({ IpRanges: [{ CidrIp: '0.0.0.0/0' }, { CidrIp: '10.0.0.0/8' }], Ipv6Ranges: [{ CidrIpv6: '::/0' }, { CidrIpv6: '2001:db8::/32' }] }))
      .toEqual(['0.0.0.0/0', '::/0']);
    expect(internetSources({ IpRanges: [{ CidrIp: '203.0.113.0/24' }] })).toEqual([]);
    expect(internetSources({})).toEqual([]);
  });
});

describe('openAdminRules', () => {
  it('reports an IPv6-only open rule (::/0)', () => {
    expect(openAdminRules({ GroupId: 'sg-1', IpPermissions: [{ IpProtocol: 'tcp', FromPort: 22, ToPort: 22, Ipv6Ranges: [{ CidrIpv6: '::/0' }] }] })).toEqual([
      { security_group_id: 'sg-1', protocol: 'tcp', from_port: 22, to_port: 22, cidr: '::/0', admin_ports: [22] },
    ]);
  });

  it('reports one entry per internet source of a rule', () => {
    const rules = openAdminRules({ GroupId: 'sg-1', IpPermissions: [tcp(5432, 5432, { Ipv6Ranges: [{ CidrIpv6: '::/0' }] })] });
    expect(rules.map((r) => r.cidr)).toEqual(['0.0.0.0/0', '::/0']);
  });

  it('reports an all-protocols rule without a port range', () => {
    expect(openAdminRules({ GroupId: 'sg-1', IpPermissions: [{ IpProtocol: '-1', IpRanges: [{ CidrIp: '0.0.0.0/0' }] }] })).toEqual([
      { security_group_id: 'sg-1', protocol: '-1', from_port: null, to_port: null, cidr: '0.0.0.0/0', admin_ports: [...ADMIN_DB_PORTS] },
    ]);
  });

  it.each([
    ['an admin port open only to a private range', [tcp(22, 22, { IpRanges: [{ CidrIp: '10.0.0.0/8' }] })]],
    ['an admin port open only to another security group', [{ IpProtocol: 'tcp', FromPort: 22, ToPort: 22, UserIdGroupPairs: [{ GroupId: 'sg-2' }] } as IngressRule]],
    ['443 open to the internet', [tcp(443, 443)]],
    ['icmp open to the internet', [{ IpProtocol: 'icmp', FromPort: -1, ToPort: -1, IpRanges: [{ CidrIp: '0.0.0.0/0' }] }]],
    ['no rules', []],
  ])('%s is not reported', (_name, permissions) => {
    expect(openAdminRules({ GroupId: 'sg-1', IpPermissions: permissions })).toEqual([]);
  });
});

describe('evaluateNetworkExposure', () => {
  const open = { GroupId: 'sg-open', IpPermissions: [tcp(0, 65535)] };
  const closed = { GroupId: 'sg-closed', IpPermissions: [tcp(443, 443)] };
  const groups = new Map([['sg-open', open], ['sg-closed', closed]]);

  it('open_admin_port when an attached group has such a rule', () => {
    const result = evaluateNetworkExposure(['sg-closed', 'sg-open'], groups);
    expect(result.state).toBe('open_admin_port');
    expect((result as any).rules).toHaveLength(1);
    expect((result as any).rules[0]).toMatchObject({ security_group_id: 'sg-open', from_port: 0, to_port: 65535 });
  });

  it('not_established when every attached group was read and none has one', () => {
    expect(evaluateNetworkExposure(['sg-closed'], groups)).toEqual({ state: 'not_established' });
  });

  it('an open group that is not attached to the instance does not count', () => {
    expect(evaluateNetworkExposure(['sg-closed'], groups)).toEqual({ state: 'not_established' });
  });

  it('unknown when the groups could not be read at all', () => {
    expect(evaluateNetworkExposure(['sg-open'], null)).toEqual({ state: 'unknown', reason: 'security_groups_unreadable' });
  });

  it('unknown when an attached group was not returned and the others show nothing', () => {
    expect(evaluateNetworkExposure(['sg-closed', 'sg-missing'], groups)).toEqual({ state: 'unknown', reason: 'security_groups_unreadable' });
  });

  it('a verified open rule stands even when another attached group was not returned', () => {
    expect(evaluateNetworkExposure(['sg-open', 'sg-missing'], groups).state).toBe('open_admin_port');
  });

  it('an instance with no security group reported has nothing established', () => {
    expect(evaluateNetworkExposure([], groups)).toEqual({ state: 'not_established' });
  });
});

describe('describeRulePorts', () => {
  it.each([
    [{ protocol: 'tcp', from_port: 22, to_port: 22 }, 'tcp 22'],
    [{ protocol: 'tcp', from_port: 0, to_port: 65535 }, 'tcp 0-65535'],
    [{ protocol: 'udp', from_port: 11211, to_port: 11211 }, 'udp 11211'],
    [{ protocol: '-1', from_port: null, to_port: null }, 'all protocols and ports'],
  ])('%p reads %s', (rule, expected) => {
    expect(describeRulePorts(rule)).toBe(expected);
  });
});
