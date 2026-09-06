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

Use the same production `JWT_SECRET` in `backend-quotation/prod.env`.
