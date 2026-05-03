# PMS Backend

Phase 1 scaffold for the Patient Management System backend.

Run `npm install` then `npm run dev` to start in development (after setting `.env`).

## Predictive Care configuration

The Node backend proxies ML predictions through the Python service. Set the ML service URL with:

- `ML_SERVICE_URL=http://127.0.0.1:8000` for local development
- a deployed HTTPS URL for production or staging

The frontend should point at the Node backend via `NEXT_PUBLIC_API_URL` so the browser always talks to the authenticated API layer instead of the ML service directly.
