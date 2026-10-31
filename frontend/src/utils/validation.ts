/* ==========================================================================
   Client-Side Input Validators & Password Strength Rules (SPEC.md §8, §12.4)
   - Regex: ^(?=.*[a-z])(?=.*[A-Z])(?=.*[^A-Za-z0-9]).{9,}$
   ========================================================================== */

export const PASSWORD_STRENGTH_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[^A-Za-z0-9]).{9,}$/;
export const EMAIL_FORMAT_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

