const VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

let warnedSkipping = false;

export async function verifyRecaptcha(token: string | undefined, remoteIp?: string): Promise<boolean> {
  if (process.env.NODE_ENV !== 'production') {
    if (!warnedSkipping) {
      console.warn('[recaptcha] skipping verification outside production.');
      warnedSkipping = true;
    }
    return true;
  }

  const secret = process.env.RECAPTCHA_SECRET_KEY;
  if (!secret) {
    console.error('[recaptcha] RECAPTCHA_SECRET_KEY is not set - rejecting submission.');
    return false;
  }
  if (!token) return false;

  try {
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token, ...(remoteIp ? { remoteip: remoteIp } : {}) }),
    });
    const body = await res.json().catch(() => ({})) as { success?: boolean };
    return body.success === true;
  } catch (err) {
    console.error('[recaptcha] verification request failed', err);
    return false;
  }
}
