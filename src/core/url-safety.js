export function parseIPv4Address(hostname) {
  const parts = hostname.split('.');
  if (parts.length !== 4) return null;

  const bytes = parts.map((part) => {
    if (!/^\d+$/.test(part)) return null;
    const value = Number(part);
    return value >= 0 && value <= 255 ? value : null;
  });

  return bytes.every((byte) => byte !== null) ? bytes : null;
}

export function isPrivateIPv4(bytes) {
  const [a, b] = bytes;

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

export function isLocalOrPrivateHostname(hostname) {
  const host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (!host) return true;

  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return true;
  }

  const ipv4 = parseIPv4Address(host);
  if (ipv4) {
    return isPrivateIPv4(ipv4);
  }

  if (host.includes(':')) {
    if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;

    const firstHextet = Number.parseInt(host.split(':')[0], 16);
    if (!Number.isFinite(firstHextet)) return true;

    return (firstHextet & 0xfe00) === 0xfc00 || (firstHextet & 0xffc0) === 0xfe80;
  }

  return !host.includes('.');
}

export function getSafeFaviconUrl(favIconUrl) {
  if (typeof favIconUrl !== 'string' || !favIconUrl) return '';

  try {
    const url = new URL(favIconUrl);

    if (url.protocol === 'data:') {
      return url.href.toLowerCase().startsWith('data:image/') ? favIconUrl : '';
    }

    if (url.protocol !== 'https:') {
      return '';
    }

    return isLocalOrPrivateHostname(url.hostname) ? '' : favIconUrl;
  } catch {
    return '';
  }
}
