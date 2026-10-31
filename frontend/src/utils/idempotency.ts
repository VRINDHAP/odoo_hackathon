/* ==========================================================================
   Idempotency Key Generator (SPEC.md §8, §16)
   ========================================================================== */

export function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const rand = (Math.random() * 16) | 0;
    const val = ch === 'x' ? rand : (rand & 0x3) | 0x8;
    return val.toString(16);
  });
}

