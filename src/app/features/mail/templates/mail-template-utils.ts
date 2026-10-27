import { MailTemplateAsset, MAIL_TEMPLATE_LIMITS } from '../models/mail-template.models';

const PLACEHOLDER_PATTERN = /{{\s*([A-Za-z_][A-Za-z0-9_]*)\s*}}/g;
const ANY_PLACEHOLDER_PATTERN = /{{(.*?)}}/gs;

export interface CursorInsertion {
  value: string;
  cursor: number;
}

export function insertAtCursor(
  value: string,
  insertion: string,
  selectionStart: number | null,
  selectionEnd: number | null,
): CursorInsertion {
  const start = selectionStart ?? value.length;
  const end = selectionEnd ?? start;
  return {
    value: `${value.slice(0, start)}${insertion}${value.slice(end)}`,
    cursor: start + insertion.length,
  };
}

export function templatePlaceholders(...values: string[]): string[] {
  const found = new Set<string>();
  for (const value of values) {
    for (const match of value.matchAll(PLACEHOLDER_PATTERN)) found.add(match[1]);
  }
  return [...found].sort();
}

export function unknownTemplatePlaceholders(
  allowedKeys: readonly string[],
  ...values: string[]
): string[] {
  const allowed = new Set(allowedKeys);
  const unknown = new Set<string>();
  for (const value of values) {
    const remainder = value.replace(ANY_PLACEHOLDER_PATTERN, (_match, inner: string) => {
      const key = inner.trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || !allowed.has(key)) {
        unknown.add(key || 'malformed');
      }
      return '';
    });
    if (remainder.includes('{{') || remainder.includes('}}')) unknown.add('malformed');
  }
  return [...unknown].sort();
}

export function prepareTemplateHtmlForSave(html: string): string {
  if (typeof DOMParser === 'undefined') return html.replace(/\s+src=(['"])blob:[^'"]*\1/gi, '');
  const document = new DOMParser().parseFromString(html || '', 'text/html');
  for (const image of Array.from(document.body.querySelectorAll('img'))) {
    if (image.hasAttribute('data-asset-id')) image.removeAttribute('src');
  }
  return document.body.innerHTML;
}

export function addAssetDisplaySources(html: string, sources: ReadonlyMap<string, string>): string {
  if (!html || typeof DOMParser === 'undefined') return html;
  const document = new DOMParser().parseFromString(html, 'text/html');
  for (const image of Array.from(
    document.body.querySelectorAll<HTMLImageElement>('img[data-asset-id]'),
  )) {
    const id = image.dataset['assetId'];
    const source = id ? sources.get(id) : undefined;
    if (source) image.src = source;
  }
  return document.body.innerHTML;
}

export function removeAssetFromHtml(html: string, assetId: string): string {
  if (!html || typeof DOMParser === 'undefined') return html;
  const document = new DOMParser().parseFromString(html, 'text/html');
  for (const image of Array.from(
    document.body.querySelectorAll<HTMLImageElement>('img[data-asset-id]'),
  )) {
    if (image.dataset['assetId'] === assetId) image.remove();
  }
  return document.body.innerHTML;
}

export function buildPreviewDocument(renderedHtml: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src blob: data:; style-src 'unsafe-inline'"><style>body{margin:0;padding:20px;color:#26352c;font:15px/1.6 Arial,sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}a{color:#246854}</style></head><body>${renderedHtml}</body></html>`;
}

export function fileUploadError(
  file: File,
  assets: readonly MailTemplateAsset[],
  kind: 'image' | 'attachment',
): string {
  if (file.size > MAIL_TEMPLATE_LIMITS.maxFileBytes) return 'Files must be 10 MiB or smaller.';
  if (assets.length >= MAIL_TEMPLATE_LIMITS.maxAssets) return 'This version already has 20 assets.';
  const estimatedTotal = [...assets.map((asset) => asset.size_bytes), file.size].reduce(
    (total, bytes) => total + Math.ceil(bytes / 3) * 4,
    0,
  );
  if (estimatedTotal + 4096 > MAIL_TEMPLATE_LIMITS.maxEncodedTotalBytes) {
    return 'Adding this file may exceed the 25 MiB encoded message limit.';
  }
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  const imageExtensions = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);
  if (kind === 'image' && !imageExtensions.has(extension)) {
    return 'Inline images must be PNG, JPEG, GIF, or WebP.';
  }
  const attachmentExtensions = new Set([...imageExtensions, 'pdf', 'docx', 'xlsx', 'txt', 'csv']);
  if (kind === 'attachment' && !attachmentExtensions.has(extension)) {
    return 'Attachments must be an image, PDF, DOCX, XLSX, TXT, or CSV file.';
  }
  return '';
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
