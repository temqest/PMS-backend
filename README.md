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
- Reseed the full patient workflow in one command:
  - `npm run seed`
  - Seeds patients, matching patient auth users, embedded insurance details, appointments, health records, prescription invoices, and predictive-care dependent collections cleanup.
  - Default credential export path: `logs/patient-auth-credentials.csv`
  - Predictive enrichment is skipped by default; use `node scripts/seedTestData.js --predictive` or `SEED_RUN_PREDICTIVE=true`.
- Reset seeded workflow data without reseeding:
  - `npm run seed:reset`
- Smaller deterministic test dataset:
  - `npm run seed:test`

## Unified seed workflow

The unified seeder lives in `scripts/seedTestData.js` and replaces the older fragmented manual sequence.

- Safe by default:
  - Refuses to run while `NODE_ENV=production` unless `SEED_ALLOW_PRODUCTION=true` or `--allow-production` is explicitly supplied.
- Deterministic:
  - Patient records, insurance assignments, and patient login credentials are generated from the same seed input.
- Correct ordering:
  - Cleanup runs first, then patients, patient auth users, appointments, health records, invoices, and optional predictive enrichment.
- No orphan records:
  - Patient-role users and dependent patient workflow collections are cleared before reseeding.

Useful options:

- `node scripts/seedTestData.js --patient-count=80 --seed=42 --window-months=20`
- `node scripts/seedTestData.js --predictive`
- `node scripts/seedTestData.js --reset-only`
- `node scripts/seedTestData.js --export=logs/custom-patient-auth.csv`

Seeded patient logins:

- Patient users are created with `role: patient`, `is_active: true`, and `patient_id` matching the seeded patient.
- Password format is deterministic by default: `SeedPatient!<seed>-<sequence>`
- Example with the default seed:
  - `ava.brown.1@example.com / SeedPatient!042-0001`
  - `jane.brown.2@example.com / SeedPatient!042-0002`

Security note: the credential export contains plaintext passwords for bootstrap access. Keep it local, do not commit it, and rotate credentials after onboarding.
