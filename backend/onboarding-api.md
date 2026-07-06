# Onboarding API

Base path: `/api/onboarding`

---

## POST `/send_otp`

Send an OTP to the user's email.

**Request body**
```json
{ "onboardingKey": "string" }
```

**Responses**

| Status | Body | When |
|--------|------|------|
| 200 | `{ "sent": true, "resendCount": number, "nextResendAt": "ISO8601" }` | OTP sent successfully |
| 200 | `{ "sent": false, "reason": "too_soon", "nextResendAt": "ISO8601", "resendCount": number }` | Requested too soon after last send or last successful auth |
| 200 | `{ "sent": false, "reason": "max_resends", "resendCount": number }` | Resend limit reached |
| 400 | `{ "error": "onboardingKey is required." }` | Missing body field |
| 404 | `{ "error": "Invalid onboarding key." }` | Key not found |
| 502 | `{ "error": "string" }` | Email send failure |

**Notes**
- `resendCount` is the total number of OTPs sent in this session.
- `nextResendAt` is an ISO 8601 timestamp. Do not allow resend before this time.
- Cooldown increases with each resend (`cooldown × resendCount`).
- After a successful `verify_otp`, the `resendCount` resets to 0.

---

## POST `/verify_otp`

Verify the OTP entered by the user.

**Request body**
```json
{ "onboardingKey": "string", "otp": "string" }
```

**Responses**

| Status | Body | When |
|--------|------|------|
| 200 | `{ "verified": true }` | OTP correct — `onboarding-auth` cookie is set |
| 400 | `{ "verified": false, "reason": "not_found" }` | `onboardingKey` does not exist |
| 400 | `{ "verified": false, "reason": "expired" }` | All OTPs for this key have expired |
| 400 | `{ "verified": false, "reason": "invalid_otp" }` | Wrong code |
| 400 | `{ "error": "onboardingKey and otp are required." }` | Missing body fields |
| 429 | `{ "verified": false, "reason": "max_attempts" }` | Too many wrong attempts |
| 500 | `{ "error": "OTP verification failed." }` | Server error |

**Notes**
- On success, the server sets an `onboarding-auth` cookie (`httpOnly`, `sameSite: strict`). No auth token is returned in the body.
- Previous OTPs from resends remain valid until they expire — any of them can be used (handles email delivery delay).
- After `max_attempts` is exceeded, no further attempts are accepted for any active OTP.
