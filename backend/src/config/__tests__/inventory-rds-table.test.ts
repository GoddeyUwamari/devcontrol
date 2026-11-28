/**
 * Placeholder-costs fix round 1 (ruling 2): the inventory RDS table is AWS list price, not a
 * hand-typed figure. Every entry equals the AWS Price List data in rds-instance-prices.json
 * (us-east-1, MySQL and MariaDB General Public License, Single-AZ) x 730 hours, to the cent.
 */
import { RDS_INSTANCE_HOURLY_PRICE_SOURCE, RDS_INSTANCE_MONTHLY_USD_US_EAST_1_MYSQL_SINGLE_AZ, rdsInstanceHourlyPrice } from '../aws-pricing';

describe('RDS_INSTANCE_MONTHLY_USD_US_EAST_1_MYSQL_SINGLE_AZ', () => {
  it('the offer version the figures come from', () => {
    expect(RDS_INSTANCE_HOURLY_PRICE_SOURCE.version).toBe('20261124233028');
  });

  it.each(Object.entries(RDS_INSTANCE_MONTHLY_USD_US_EAST_1_MYSQL_SINGLE_AZ))('%s = list price x 730 (MySQL and MariaDB)', (instanceClass, monthly) => {
    for (const engine of ['mysql', 'mariadb']) {
      const hourly = rdsInstanceHourlyPrice({ region: 'us-east-1', engine, licenseModel: 'general-public-license', instanceClass, multiAz: false });
      expect(hourly).not.toBeNull();
      expect(monthly).toBe(Math.round(hourly! * 730 * 100) / 100);
    }
  });

  it('covers exactly the eight classes discovery has always estimated', () => {
    expect(Object.keys(RDS_INSTANCE_MONTHLY_USD_US_EAST_1_MYSQL_SINGLE_AZ).sort()).toEqual(
      ['db.m5.large', 'db.m5.xlarge', 'db.r5.large', 'db.r5.xlarge', 'db.t3.large', 'db.t3.medium', 'db.t3.micro', 'db.t3.small']
    );
  });
});
