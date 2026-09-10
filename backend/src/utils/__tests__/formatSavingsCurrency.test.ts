import { formatSavingsCurrency } from '../formatSavingsCurrency';

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
