const CONTACT_WINDOW_MS = 15 * 60 * 1000;
const MAX_CONTACT_REDIRECTS = 20;

interface ContactAttempt {
  count: number;
  windowStart: number;
}

const contactAttempts = new Map<string, ContactAttempt>();

export function createPublicContactTarget(
  phone: string,
  title: string,
  priceIqd: number,
  channel: 'call' | 'whatsapp'
): string | null {
  if (!/^07[3-9]\d{8}$/.test(phone)) return null;
  if (channel === 'call') return `tel:${phone}`;

  const internationalPhone = `964${phone.slice(1)}`;
  const message = `مرحباً، أستفسر عن إعلانك في دراجتي: ${title} (${new Intl.NumberFormat(
    'en-US'
  ).format(priceIqd)} دينار عراقي)`;
  return `https://wa.me/${internationalPhone}?text=${encodeURIComponent(message)}`;
}

export function allowPublicContactRedirect(
  clientKey: string,
  now = Date.now(),
  attempts: Map<string, ContactAttempt> = contactAttempts
): boolean {
  const current = attempts.get(clientKey);
  if (!current || now - current.windowStart >= CONTACT_WINDOW_MS) {
    attempts.set(clientKey, { count: 1, windowStart: now });
    return true;
  }
  if (current.count >= MAX_CONTACT_REDIRECTS) return false;
  current.count += 1;
  return true;
}
