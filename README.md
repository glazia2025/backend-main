# Glazia Main Backend

This service owns the main-site API surface:

- `/api/auth`
- `/api/admin`
- `/api/user`
- `/api/profile`

Login stays here. The JWT issued by this service is accepted by the quotation
service when both services use the same `JWT_SECRET` and `AUTH_COOKIE_NAME`.

## Run

```bash
npm install
cp .env.example prod.env
npm start
```

In local development (`NODE_ENV` other than `production`), login OTPs are
printed to the backend terminal as `[DEV OTP] <phone>: <otp>` and are not sent
through WhatsApp. Production requires `META_TOKEN` and `META_NUMID`.

The admin portal also supports one environment-managed super admin. Configure
`SUPER_ADMIN_EMAIL` and `SUPER_ADMIN_PASSWORD` (and optionally
`SUPER_ADMIN_NAME`). This credential receives unrestricted (`*`) admin access;
database-managed administrator accounts continue to sign in by mobile OTP.

Use the same production `JWT_SECRET` in `backend-quotation/prod.env`.

## Manual NALCO WhatsApp broadcast

The React admin dashboard (`Glazia-Windoors/frontend`) includes a NALCO WhatsApp
update panel for admins with `USERS` permission (including super admins).
`GET /api/admin/nalco-broadcast` returns the latest stored rate and last manual
broadcast. `POST /api/admin/nalco-broadcast` accepts `{ "rateId": "<confirmed latest record id>" }`,
rechecks the latest rate, and starts a background broadcast using the existing
`daily_update` template and recipient normalization/deduplication.

The result is persisted in MongoDB's `nalcobroadcasts` collection. Counts describe
API request acceptance, not device delivery. No automatic retry is performed.
The database lock prevents concurrent manual broadcasts across server processes;
it does not suppress the scheduled cron broadcast. Avoid manual sends near a
scheduled send unless another message is intended.

The worker runs in the API process. If that process stops during a send, the
record stays `running` and further manual sends are blocked to avoid duplicates.
After verifying the worker is stopped and investigating the accepted requests,
an operator can mark that record `failed` in MongoDB to unlock manual sending.
Do not clear the lock while a worker may still be running. This is not a durable
queue and does not resume interrupted broadcasts automatically.

The **Pull latest rate & send** button posts `{ "pullLatest": true }` to the same
endpoint. After acquiring the manual broadcast lock, it downloads and parses the
NALCO PDF, saves a new rate observation, then sends that fetched rate. A fetch,
validation, or database-save failure stops the operation without sending a
stored fallback rate. The status panel shows fetching/sending progress.
