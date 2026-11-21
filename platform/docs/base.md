# @stg/base contract

Phase 1 of the roadmap. All names below are the wire names (SQL, subscriptions, `spacetime call`). Generated TypeScript bindings use camelCase accessors.

## Environment

| Key | Required | Use |
|---|---|---|
| `OTP_SECRET` | yes | HMAC key for login codes and test codes. 32+ random bytes. |
| `ADMIN_PHONES` | no | Comma list. These phones become `owner` on login. Use it to bootstrap the first owner. |

## Roles

`owner` > `admin` > `operator`. A higher role can do everything a lower one can.

- `operator`: dashboard, account list, admin list, settings view.
- `admin`: every setting, SMS providers, test phones, languages, key types, categories, tags, account status, audit log.
- `owner`: adds, changes and removes admins. The last owner cannot be removed or demoted.

## Public tables

`base_brand` (one row, id 0), `base_language`, `base_key_type`, `base_category`, `base_tag`. Titles are `Translation[]` = `{ lang, text }[]`; resolve with the account language, then the default language.

## Private tables

`base_account`, `base_session` (Identity → account), `base_otp`, `base_otp_daily`, `base_test_phone`, `base_sandbox_sms`, `base_admin`, `base_sms_provider`, `base_settings` (one row, id 0), `base_audit`.

## Views

| View | Who | Rows |
|---|---|---|
| `me` | anyone | the logged-in account, or none |
| `my_role` | anyone | the caller's admin row, or none |
| `admin_settings` | operator | settings row |
| `admin_admins` | operator | admins with phone and name |
| `admin_sms_providers` | admin | providers with `apiKeyMasked` and `hasKey`; the key itself never leaves the server |
| `admin_test_phones` | admin | fixed-code phones |
| `admin_sandbox_sms` | admin | last 50 sandbox messages |

## Login

1. Connect with no token. Save the token the server returns; it is the device identity.
2. `request_otp(phone)` → `{ phone, codeLength, expiresInSec, retryAfterSec }`. Phone may use Persian digits, +98, 0098 or 9xx.
3. `verify_otp(phone, code)` → `{ ok, error, accountId, isNew, attemptsLeft, role }`. `error` is `NO_CODE`, `EXPIRED`, `WRONG_CODE`, `TOO_MANY_ATTEMPTS` or `ACCOUNT_BLOCKED`.
4. A second device logs in the same way and reaches the same account. `logout` ends only this device.

Codes are `HMAC(OTP_SECRET, phone, time, sender, salt)`; the server stores only their hash. Test phones (store reviewers) always get their fixed code and never use an SMS or the daily cap.

`request_otp` errors: `INVALID_PHONE`, `ACCOUNT_BLOCKED`, `RETRY_LATER:<seconds>`, `DAILY_LIMIT`, `SMS_NOT_CONFIGURED`, `SMS_FAILED`. A failed send removes the code and does not count toward the daily cap.

## SMS providers

One provider is active at a time. Kinds:

- `sandbox`: no SMS; the text goes to `base_sandbox_sms` and the log (`SANDBOX_SMS`).
- `kavenegar`: with `otpTemplate`, login codes use `verify/lookup.json` (`token` = code); without it, `sms/send.json` plain text from `sender`.
- `smsir`: with a numeric `otpTemplate` (template id), login codes use `/v1/send/verify` with parameter `otpCodeVar` (default `CODE`); without it, `/v1/send/bulk` from line `sender`.

An empty `apiKey` on edit keeps the stored key. `admin_test_sms(providerId, phone, otp)` sends a real test message and returns `{ mode, code }`.

## Admin reducers

`admin_save_settings`, `admin_complete_setup`, `admin_save_brand`, `admin_save_sms_provider`, `admin_delete_sms_provider`, `admin_save_test_phone`, `admin_delete_test_phone`, `admin_clear_sandbox_sms`, `admin_save_language`, `admin_set_default_language`, `admin_delete_language`, `admin_save_key_type`, `admin_delete_key_type`, `admin_save_category`, `admin_delete_category`, `admin_save_tag`, `admin_delete_tag`, `admin_set_admin`, `admin_remove_admin`, `admin_set_account_status`. Every change writes `base_audit`.

## Admin procedures

- `admin_accounts(query, status, page, pageSize)` → `{ total, rows }`, newest first. Query matches phone, name or id.
- `admin_audit(action, page, pageSize)` → `{ total, rows }`. `action` is a prefix such as `account.`.
- `admin_dashboard()` → counts for accounts, new and active today (Tehran day), blocked, admins, sessions, languages, categories, tags, active SMS kind and the setup flag.

## Defaults (seeded by `init`)

OTP: 5 digits, 120 s life, 60 s resend wait, 5 attempts, 10 codes a day per phone. Languages fa (default, rtl) and en. Key types `general` (categories and tags) and `user` (player tags), both system. One active sandbox SMS provider. Brand «بازی من».

## Error codes

`NOT_LOGGED_IN`, `ACCOUNT_BLOCKED`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_PHONE`, `INVALID_CODE`, `INVALID_KEY`, `INVALID_URL`, `INVALID_COLOR`, `INVALID_EMAIL`, `INVALID_ROLE`, `INVALID_STATUS`, `INVALID_DIR`, `INVALID_LANGUAGE_CODE`, `INVALID_OTP_LENGTH`, `INVALID_OTP_TTL`, `INVALID_OTP_RESEND`, `INVALID_OTP_ATTEMPTS`, `INVALID_OTP_DAILY_CAP`, `NAME_REQUIRED`, `TITLE_REQUIRED`, `UNKNOWN_LANGUAGE`, `LANGUAGE_INACTIVE`, `DEFAULT_LANGUAGE`, `DEFAULT_LANGUAGE_INACTIVE`, `UNKNOWN_KEY_TYPE`, `KEY_TYPE_NOT_ALLOWED`, `KEY_TYPE_UNUSED`, `KEY_TYPE_SYSTEM`, `KEY_TYPE_IN_USE`, `KEY_TAKEN`, `PARENT_NOT_FOUND`, `PARENT_KEY_TYPE`, `PARENT_CYCLE`, `CATEGORY_HAS_CHILDREN`, `SMS_KIND_UNKNOWN`, `API_KEY_REQUIRED`, `SMS_TEMPLATE_INVALID`, `PROVIDER_ACTIVE`, `SMS_NOT_CONFIGURED`, `SMS_FAILED`, `RETRY_LATER:<s>`, `DAILY_LIMIT`, `LAST_OWNER`, `CANNOT_CHANGE_SELF`, `CANNOT_BLOCK_OWNER`, `NOT_INITIALIZED`.
