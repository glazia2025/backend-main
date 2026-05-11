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

Use the same production `JWT_SECRET` in `backend-quotation/prod.env`.
