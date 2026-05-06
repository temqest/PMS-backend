# PMS Backend

Phase 1 scaffold for the Patient Management System backend.

Run `npm install` then `npm run dev` to start in development (after setting `.env`).

## Predictive Care configuration

The Node backend proxies ML predictions through the Python service. Set the ML service URL with:

- `ML_SERVICE_URL=http://127.0.0.1:8000` for local development
- a deployed HTTPS URL for production or staging

The frontend should point at the Node backend via `NEXT_PUBLIC_API_URL` so the browser always talks to the authenticated API layer instead of the ML service directly.

**Clinical / product note:** predictive outputs are **decision support only** (see `predictive_care_disclaimer` on profile API responses). Utilization risk uses a **visit-based 90-day proxy** when hospitalization data is not modeled; train the Python models after large data imports (`machine_learning_backend/README.md`).

**Retraining:** authorized roles can call `POST /api/v1/predictive-care/ml/retrain`, which forwards to the FastAPI `POST /train` on the ML service.

## Persistent auth scripts

Patient and admin authentication is now persisted in MongoDB via the `User` collection.

- Create or update an admin account:
  - `node scripts/createAdmin.js admin@clinic.com SecurePass123 "Admin User"`
- Backfill patient auth users and export credentials:
  - `node scripts/seedPatientAuthUsers.js`
  - Default export path: `logs/patient-auth-credentials.csv`
  - Use `--reset-passwords` to regenerate passwords for existing patient users and include new plaintext credentials in the export.
  - Use `--output=logs/custom-name.csv` to change export path.

Security note: the credential export contains plaintext passwords for bootstrap access. Keep it local, do not commit it, and rotate credentials after onboarding.
