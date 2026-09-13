/**
 * Security Truthfulness #40: the "Security Status" CSV export column previously used
 * `if (r.is_encrypted) return '✓ Encrypted'` -- bare JS truthiness, so a null (unknown)
 * resource fell through to `'✗ Not Encrypted'`, fabricating a negative claim in an
 * exported, customer-facing artifact. true/false branches and their precedence against
 * is_public are unchanged; only the new null branch is added.
 */
import { AWSResourcesExportService } from '../awsResourcesExport.service';

describe('AWSResourcesExportService — Security Status column truthiness safety', () => {
  const formatter = (AWSResourcesExportService as any).COLUMN_MAPPINGS.security.formatter;

  it('is_encrypted === true -> "✓ Encrypted" (unchanged)', () => {
    expect(formatter({ is_encrypted: true, is_public: false })).toBe('✓ Encrypted');
  });

  it('is_encrypted === false and is_public -> "⚠ Public" (unchanged precedence)', () => {
    expect(formatter({ is_encrypted: false, is_public: true })).toBe('⚠ Public');
  });

  it('is_encrypted === false and not public -> "✗ Not Encrypted" (unchanged)', () => {
    expect(formatter({ is_encrypted: false, is_public: false })).toBe('✗ Not Encrypted');
  });

  it('is_encrypted === null (unknown) and not public -> an explicit "Unknown" label, never "✗ Not Encrypted"', () => {
    const result = formatter({ is_encrypted: null, is_public: false });
    expect(result).not.toBe('✗ Not Encrypted');
    expect(result).toMatch(/unknown/i);
  });

  it('is_encrypted === null and public -> still surfaces the public warning, not a fabricated encryption claim', () => {
    const result = formatter({ is_encrypted: null, is_public: true });
    expect(result).toBe('⚠ Public');
  });
});
