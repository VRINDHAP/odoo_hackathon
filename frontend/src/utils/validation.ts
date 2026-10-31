/* ==========================================================================
   Client-Side Input Validators & Password Strength Rules (SPEC.md §8, §12.4)
   - Regex: ^(?=.*[a-z])(?=.*[A-Z])(?=.*[^A-Za-z0-9]).{9,}$
   ========================================================================== */

export const PASSWORD_STRENGTH_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[^A-Za-z0-9]).{9,}$/;
export const EMAIL_FORMAT_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PHONE_FORMAT_REGEX = /^\+?[0-9][0-9\s()-]{6,19}$/;
export const TAX_ID_FORMAT_REGEX = /^[A-Z0-9-]{6,20}$/i;
export const POSTAL_CODE_REGEX = /^[A-Z0-9\s-]{4,10}$/i;

export interface PasswordRuleState {
  minLength: boolean;
  hasLowercase: boolean;
  hasUppercase: boolean;
  hasSpecialChar: boolean;
  isValid: boolean;
}

export function evaluatePasswordStrength(password: string): PasswordRuleState {
  const minLength = password.length >= 9;
  const hasLowercase = /[a-z]/.test(password);
  const hasUppercase = /[A-Z]/.test(password);
  const hasSpecialChar = /[^A-Za-z0-9]/.test(password);
  const isValid = PASSWORD_STRENGTH_REGEX.test(password);

  return {
    minLength,
    hasLowercase,
    hasUppercase,
    hasSpecialChar,
    isValid,
  };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return EMAIL_FORMAT_REGEX.test(normalizeEmail(email));
}

export function isValidPhone(phone: string): boolean {
  const trimmed = phone.trim();
  if (!trimmed) return true;
  const digitCount = trimmed.replace(/\D/g, '').length;
  return PHONE_FORMAT_REGEX.test(trimmed) && digitCount >= 7 && digitCount <= 15;
}

export function isValidTaxId(taxId: string): boolean {
  const trimmed = taxId.trim();
  if (!trimmed) return true;
  return TAX_ID_FORMAT_REGEX.test(trimmed);
}

export function isValidPostalCode(postalCode: string): boolean {
  const trimmed = postalCode.trim();
  if (!trimmed) return true;
  return POSTAL_CODE_REGEX.test(trimmed);
}

export function isValidDateRange(startDate: string, endDate?: string | null): boolean {
  if (!endDate || !endDate.trim()) return true;
  if (!startDate || !startDate.trim()) return false;
  return endDate >= startDate;
}
