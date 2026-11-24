export type PublicContactChannel = 'call' | 'whatsapp';

export function buildPublicContactEndpoint(
  id: number,
  channel: PublicContactChannel
): string {
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error('Invalid listing id for public contact.');
  }
  return `/api/listings/${id}/contact?channel=${channel}`;
}

export function validatePublicContactTarget(
  channel: PublicContactChannel,
  target: string
): string {
  if (channel === 'call' && /^tel:07[3-9]\d{8}$/.test(target)) return target;

  if (channel === 'whatsapp') {
    try {
      const url = new URL(target);
      if (
        url.protocol === 'https:' &&
        url.hostname === 'wa.me' &&
        !url.port &&
        !url.username &&
        !url.password &&
        /^\/9647[3-9]\d{8}$/.test(url.pathname)
      ) {
        return url.href;
      }
    } catch {
      // Invalid server response is surfaced below.
    }
  }

  throw new Error('The server returned an invalid contact destination.');
}
