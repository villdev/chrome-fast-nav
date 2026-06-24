import { describe, expect, it } from 'vitest';

import {
  getSafeFaviconUrl,
  isLocalOrPrivateHostname,
  isPrivateIPv4,
  parseIPv4Address,
} from '../url-safety.js';

describe('parseIPv4Address', () => {
  it('parses valid dotted IPv4 addresses into bytes', () => {
    expect(parseIPv4Address('192.168.0.1')).toEqual([192, 168, 0, 1]);
  });

  it('rejects malformed IPv4 addresses', () => {
    expect(parseIPv4Address('192.168.0')).toBeNull();
    expect(parseIPv4Address('192.168.0.999')).toBeNull();
    expect(parseIPv4Address('192.168.zero.1')).toBeNull();
  });
});

describe('isPrivateIPv4', () => {
  it.each([
    [[0, 0, 0, 0]],
    [[10, 1, 2, 3]],
    [[100, 64, 0, 1]],
    [[100, 127, 255, 255]],
    [[127, 0, 0, 1]],
    [[169, 254, 1, 1]],
    [[172, 16, 0, 1]],
    [[172, 31, 255, 255]],
    [[192, 168, 1, 1]],
    [[198, 18, 0, 1]],
    [[198, 19, 255, 255]],
  ])('marks %j as private/local', (bytes) => {
    expect(isPrivateIPv4(bytes)).toBe(true);
  });

  it.each([[[8, 8, 8, 8]], [[100, 128, 0, 1]], [[172, 32, 0, 1]], [[198, 20, 0, 1]]])(
    'does not mark %j as private/local',
    (bytes) => {
      expect(isPrivateIPv4(bytes)).toBe(false);
    },
  );
});

describe('isLocalOrPrivateHostname', () => {
  it.each([
    [''],
    ['localhost'],
    ['app.localhost'],
    ['printer.local'],
    ['internal'],
    ['example.local.'],
    ['10.0.0.1'],
    ['172.16.0.1'],
    ['192.168.1.20'],
    ['[::1]'],
    ['0:0:0:0:0:0:0:1'],
    ['fd12:3456::1'],
    ['fe80::1'],
  ])('marks %s as local or private', (hostname) => {
    expect(isLocalOrPrivateHostname(hostname)).toBe(true);
  });

  it.each([
    ['example.com'],
    ['sub.example.com'],
    ['8.8.8.8'],
    ['100.128.0.1'],
    ['172.32.0.1'],
    ['2606:4700:4700::1111'],
  ])('does not mark %s as local or private', (hostname) => {
    expect(isLocalOrPrivateHostname(hostname)).toBe(false);
  });
});

describe('getSafeFaviconUrl', () => {
  it('allows public HTTPS favicon URLs', () => {
    const favicon = 'https://example.com/favicon.ico';

    expect(getSafeFaviconUrl(favicon)).toBe(favicon);
  });

  it('allows image data URLs and preserves the original value', () => {
    const favicon = 'data:image/svg+xml,<svg></svg>';

    expect(getSafeFaviconUrl(favicon)).toBe(favicon);
  });

  it.each([
    [''],
    [null],
    ['not a url'],
    ['http://example.com/favicon.ico'],
    ['ftp://example.com/favicon.ico'],
    ['data:text/html,<p>nope</p>'],
    ['https://localhost/favicon.ico'],
    ['https://internal/favicon.ico'],
    ['https://192.168.0.1/favicon.ico'],
    ['https://[fd12:3456::1]/favicon.ico'],
  ])('rejects unsafe favicon URL %j', (favicon) => {
    expect(getSafeFaviconUrl(favicon)).toBe('');
  });

  it('allows public IPv6 HTTPS favicon URLs', () => {
    const favicon = 'https://[2606:4700:4700::1111]/favicon.ico';

    expect(getSafeFaviconUrl(favicon)).toBe(favicon);
  });
});
