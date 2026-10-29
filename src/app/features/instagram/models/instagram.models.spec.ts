import {
  INSTAGRAM_REPLY_MAX_UTF8_BYTES,
  instagramReplyIsValid,
  instagramReplyUtf8Bytes,
} from './instagram.models';

describe('Instagram reply validation', () => {
  it('supports Unicode, Bangla and line breaks within the UTF-8 contract', () => {
    const value = 'ধন্যবাদ\nWe received your message.';
    expect(instagramReplyIsValid(value)).toBe(true);
    expect(instagramReplyUtf8Bytes(value)).toBeGreaterThan(value.length);
  });

  it('rejects blank, null-character and over-byte-limit text', () => {
    expect(instagramReplyIsValid('   \n')).toBe(false);
    expect(instagramReplyIsValid('hello\0world')).toBe(false);
    expect(instagramReplyIsValid('আ'.repeat(INSTAGRAM_REPLY_MAX_UTF8_BYTES))).toBe(false);
  });
});
