# Deployment Setup

## Service order

1. Deploy `machine_learning_backend`
2. Deploy backend API from the repository root
3. Deploy `pms-frontend`

## Backend

- Build command: `npm install`
- Start command: `npm start`
- Health check: `/health`

Required environment variables:

- `NODE_ENV=production`
- `PORT=5000`
- `MONGO_URI=<mongodb connection string>`
- `JWT_SECRET=<long random secret>`
- `JWT_EXPIRES_IN=7d`
- `ML_SERVICE_URL=https://<your-ml-service>.onrender.com`
- `ML_SERVICE_INTERNAL_URL=<optional private ML URL>`
- `CORS_ALLOWED_ORIGINS=https://<your-frontend-domain>`
- `PRESCRIPTION_API_URL=<inventory service url>`
- `PRESCRIPTION_API_KEY=<optional external inventory API key>`
- `PRESCRIPTION_API_BEARER_TOKEN=<optional external inventory bearer token>`

## ML service

- Build command: `pip install -r requirements.txt`
- Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
- Health check: `/health`

Required environment variables:

- `PORT=8000`
- `MONGO_URI=<mongodb connection string>`
- `MONGO_DB_NAME=pms`
- `MODEL_DIR=./models`
- `ALLOWED_ORIGINS=https://<your-frontend-domain>,https://<your-backend-domain>`

Keep the trained `.joblib` files inside `machine_learning_backend/models/` in the deployable source unless you introduce a separate artifact storage step.

## Frontend

- Build command: `npm install && npm run build`
- Start command: `npm run start`

Required environment variables:

- `NEXT_PUBLIC_API_URL=https://<your-backend-domain>`

## Connection map

- Frontend -> Backend: `NEXT_PUBLIC_API_URL`
- Backend -> ML service: `ML_SERVICE_INTERNAL_URL` first, then `ML_SERVICE_URL`
- Backend + ML service -> MongoDB: `MONGO_URI`
- Backend -> External prescription inventory: `PRESCRIPTION_API_URL` plus `PRESCRIPTION_API_KEY` or `PRESCRIPTION_API_BEARER_TOKEN`
- Frontend never calls the ML service directly
- Frontend should not store the external prescription inventory credentials when using the backend proxy

## Post-deploy checks

1. Open frontend and confirm login/signup hit the deployed backend.
2. Confirm backend `/health` reports `status: ok`.
3. Confirm ML `/health` reports `status: ok` and `model_dir_exists: true`.
4. Compute a predictive-care profile and verify the response includes ML-backed fields when the ML service is reachable.
5. Stop or misconfigure the ML URL temporarily and verify backend predictive endpoints fail safely instead of crashing the API.
