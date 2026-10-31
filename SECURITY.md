# Security Policy

Brightloop handles critical recurring financial workflows, subscriptions, billing ledgers, and customer accounts. We treat security as a first-class requirement.

---

## Supported Versions

Only the latest release version on the `main` branch receives active security updates.

| Version | Supported |
| ------- | --------- |
| 1.0.x   | Yes       |
| < 1.0   | No        |

---

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

If you discover a security vulnerability, follow these steps:

1. **Email us privately**: Send details to **security@brightloop.io**.
2. **Include details**:
   - Description of the vulnerability and its potential impact.
   - Step-by-step reproduction instructions or a minimal Proof of Concept (PoC).
   - Affected component(s): e.g., auth service, billing engine, API client, or token store.
   - Any proposed remediation if available.

### Response SLA
- **Initial Acknowledgement**: Within 24–48 hours of receipt.
- **Triage & Assessment**: Within 5 business days.
- **Fix & Patch Timeline**: Prioritized based on severity (Critical / High within 7 days).

---

## Security Practices in Brightloop

- **Password Hashing**: Argon2id with unique salts for all stored credentials.
- **Token Management**: Short-lived JWT Bearer access tokens with secure refresh hints and silent renewal.
- **Account Protection**: Exponential backoff and 5-attempt account lockout guard (`HTTP 423`).
- **Ledger Invariants**: Append-only payment audit trail, zero-overpayment bounds, and idempotent billing execution keys.
- **RBAC Isolation**: Strict role segregation preventing customers or staff from accessing unauthorized resources.

