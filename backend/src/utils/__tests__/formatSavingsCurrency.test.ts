import { formatSavingsCents, formatSavingsCurrency, formatSavingsTotal } from '../formatSavingsCurrency';

describe('formatSavingsCurrency', () => {
  it('renders null as an em dash (missing/unavailable, never a fabricated zero)', () => {
    expect(formatSavingsCurrency(null)).toBe('—');
  });

  it('renders undefined as an em dash', () => {
    expect(formatSavingsCurrency(undefined)).toBe('—');
  });

  it('renders a genuine zero as "$0", distinct from missing data', () => {
    expect(formatSavingsCurrency(0)).toBe('$0');
  });

  it('renders a genuine sub-dollar saving at 2 decimal places instead of collapsing to $0', () => {
    expect(formatSavingsCurrency(0.01)).toBe('$0.01');
    expect(formatSavingsCurrency(0.16)).toBe('$0.16');
    expect(formatSavingsCurrency(0.99)).toBe('$0.99');
  });

  it('renders a positive amount under one cent as "<$0.01", never "$0.00" (Cost Optimization tidy money rule)', () => {
    expect(formatSavingsCurrency(0.004)).toBe('<$0.01');
    expect(formatSavingsCurrency(0.0099)).toBe('<$0.01');
    expect(formatSavingsCurrency('0.004')).toBe('<$0.01');
    expect(formatSavingsCurrency(0.01)).toBe('$0.01');
  });

  it('formatSavingsTotal: a rounded total of 0 with positive estimates behind it is "<$0.01"', () => {
    expect(formatSavingsTotal(0, 2)).toBe('<$0.01');
    expect(formatSavingsTotal('0.00', 1)).toBe('<$0.01');
    expect(formatSavingsTotal(0, 0)).toBe('$0');
    expect(formatSavingsTotal(0, null)).toBe('$0');
    expect(formatSavingsTotal(12.34, 2)).toBe('$12');
    expect(formatSavingsTotal(null, 2)).toBe('—');
  });

  it('rounds to a whole dollar once the amount reaches $1', () => {
    expect(formatSavingsCurrency(1)).toBe('$1');
  });

  it('still rounds larger values to whole dollars, unchanged from prior behavior', () => {
    expect(formatSavingsCurrency(12.34)).toBe('$12');
    expect(formatSavingsCurrency(1234.56)).toBe('$1,235');
  });

  it('composes with an annualized (monthly * 12) figure using the same rounding rule', () => {
    expect(formatSavingsCurrency(0.16 * 12)).toBe('$2');
  });
});

describe('DECIMAL strings (pg returns NUMERIC columns as strings)', () => {
  it('formatSavingsCurrency accepts strings with its existing rounding', () => {
    expect(formatSavingsCurrency('0.48')).toBe('$0.48');
    expect(formatSavingsCurrency('0.00')).toBe('$0');
    expect(formatSavingsCurrency('8.50')).toBe('$9');
    expect(formatSavingsCurrency('abc')).toBe('—');
    expect(formatSavingsCurrency('')).toBe('—');
  });
});

describe('formatSavingsCents', () => {
  it('renders cents for numbers and DECIMAL strings', () => {
    expect(formatSavingsCents(0.48)).toBe('$0.48');
    expect(formatSavingsCents('0.48')).toBe('$0.48');
    expect(formatSavingsCents('0.00')).toBe('$0.00');
    expect(formatSavingsCents(0)).toBe('$0.00');
    expect(formatSavingsCents(12.5)).toBe('$12.50');
    expect(formatSavingsCents('12.5')).toBe('$12.50');
    expect(formatSavingsCents('8.50')).toBe('$8.50');
    expect(formatSavingsCents(1234.5)).toBe('$1,234.50');
  });

  it('missing or non-numeric is "—", never "$0.00"', () => {
    for (const v of [null, undefined, '', '   ', 'abc', Number.NaN]) expect(formatSavingsCents(v as never)).toBe('—');
  });
});
