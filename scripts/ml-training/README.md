# Isolated ML Training Seeder

This folder contains an isolated pipeline for generating realistic training data and training models without touching your main application database.

## What it does

1. Runs `scripts/seedTestData.js` into a separate MongoDB database.
2. Seeds realistic cohorts (default 250 patients).
3. Trains all four ML models against that isolated dataset.
4. Writes model artifacts to `machine_learning_backend/models_training` by default.

## Run

From project root:

```powershell
node scripts/ml-training/seedAndTrainIsolatedDb.js
```

## Key env overrides

- `ML_TRAINING_DB_NAME` default: `pms_ml_training`
- `ML_TRAINING_PATIENT_COUNT` default: `250`
- `ML_TRAINING_MONGO_URI` optional full URI override
- `ML_TRAINING_RUN_MODELS` default: `true`
- `ML_TRAINING_PYTHON_EXEC` default: `python`
- `ML_TRAINING_MODEL_DIR` default: `machine_learning_backend/models_training`

Example with 300 patients:

```powershell
$env:ML_TRAINING_PATIENT_COUNT='300'
node scripts/ml-training/seedAndTrainIsolatedDb.js
```

Seed-only example (skip training scripts):

```powershell
$env:ML_TRAINING_RUN_MODELS='false'
node scripts/ml-training/seedAndTrainIsolatedDb.js
```
