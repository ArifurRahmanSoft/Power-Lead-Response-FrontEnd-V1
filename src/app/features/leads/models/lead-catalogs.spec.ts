import { COUNTRY_OPTIONS, countryName } from './lead-catalogs';
import { IMPORT_CANONICAL_FIELDS } from './lead.models';

describe('lead country compatibility', () => {
  it('uses searchable country names as option values', () => {
    expect(COUNTRY_OPTIONS).toHaveLength(249);
    expect(COUNTRY_OPTIONS.find((country) => country.code === 'BD')).toMatchObject({
      value: 'Bangladesh',
      label: 'Bangladesh',
    });
  });

  it('maps older API codes and common aliases to canonical names', () => {
    expect(countryName('BD')).toBe('Bangladesh');
    expect(countryName('us')).toBe('United States');
    expect(countryName('UK')).toBe('United Kingdom');
    expect(countryName('HK')).toBe('Hong Kong');
    expect(countryName('Australia')).toBe('Australia');
  });

  it('preserves unknown names so the backend can return its authoritative validation message', () => {
    expect(countryName('Atlantis')).toBe('Atlantis');
  });

  it('matches the current backend template and mapping fields', () => {
    expect(IMPORT_CANONICAL_FIELDS).toContain('service_requested');
    expect(IMPORT_CANONICAL_FIELDS).toContain('whatsapp_number');
    expect(IMPORT_CANONICAL_FIELDS).toContain('priority');
    expect(IMPORT_CANONICAL_FIELDS).not.toContain('consent_evidence' as never);
  });
});
