import { MailTemplateAsset } from '../models/mail-template.models';
import {
  addAssetDisplaySources,
  buildPreviewDocument,
  fileUploadError,
  insertAtCursor,
  prepareTemplateHtmlForSave,
  templatePlaceholders,
  unknownTemplatePlaceholders,
} from './mail-template-utils';

describe('mail template utilities', () => {
  it('inserts a variable at the selected subject cursor', () => {
    expect(insertAtCursor('Hi Arif', '{{first_name}}', 3, 7)).toEqual({
      value: 'Hi {{first_name}}',
      cursor: 17,
    });
  });

  it('preserves allowed placeholders and explains unknown or malformed tokens', () => {
    expect(templatePlaceholders('Hi {{first_name}}', '<p>{{company}}</p>')).toEqual([
      'company',
      'first_name',
    ]);
    expect(
      unknownTemplatePlaceholders(
        ['first_name', 'company'],
        'Hi {{first_name}} {{unknown}} {{company.upper()}}',
      ),
    ).toEqual(['company.upper()', 'unknown']);
  });

  it('never persists blob or base64 sources for backend-managed images', () => {
    const html =
      '<p>Hi {{first_name}}</p><img data-asset-id="asset-id" src="blob:test" alt="Logo" width="600">';
    const saved = prepareTemplateHtmlForSave(html);
    expect(saved).toContain('{{first_name}}');
    expect(saved).toContain('data-asset-id="asset-id"');
    expect(saved).not.toContain('blob:');

    const hydrated = addAssetDisplaySources(saved, new Map([['asset-id', 'blob:display-only']]));
    expect(hydrated).toContain('blob:display-only');
  });

  it('provides early file-size, type, count and total-size feedback', () => {
    const oversized = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.pdf');
    expect(fileUploadError(oversized, [], 'attachment')).toContain('10 MiB');
    const assets = Array.from({ length: 20 }, (_, index) =>
      asset(`asset-${index}`, 100, 'attachment'),
    );
    expect(fileUploadError(new File(['x'], 'safe.pdf'), assets, 'attachment')).toContain(
      '20 assets',
    );
    expect(fileUploadError(new File(['x'], 'unsafe.svg'), [], 'image')).toContain(
      'PNG, JPEG, GIF, or WebP',
    );
  });

  it('builds a preview document with scripts and network access blocked by CSP', () => {
    const document = buildPreviewDocument('<p>Hello</p>');
    expect(document).toContain("default-src 'none'");
    expect(document).toContain('img-src blob: data:');
    expect(document).toContain('<p>Hello</p>');
  });
});

function asset(id: string, size: number, kind: MailTemplateAsset['kind']): MailTemplateAsset {
  return {
    id,
    kind,
    filename: `${id}.pdf`,
    content_type: 'application/pdf',
    size_bytes: size,
    placeholder_html: null,
    content_url: `/api/assets/${id}`,
    created_at: '2026-10-12T00:00:00Z',
  };
}
