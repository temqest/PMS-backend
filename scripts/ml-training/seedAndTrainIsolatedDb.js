/**
 * Seeds realistic predictive-care data into an isolated MongoDB database,
 * then trains ML models against that isolated dataset.
 *
 * Defaults:
 * - 250 seeded patients (realistic cohort mix from scripts/seedTestData.js)
 * - isolated DB name: pms_ml_training
 * - model output dir: machine_learning_backend/models_training
 *
 * Env overrides:
 *   MONGO_URI                   Base URI for deriving isolated URI
 *   ML_TRAINING_MONGO_URI       Full isolated URI (takes precedence)
 *   ML_TRAINING_DB_NAME         Isolated DB name (default: pms_ml_training)
 *   ML_TRAINING_PATIENT_COUNT   Seed patient count (default: 250)
 *   ML_TRAINING_RANDOM_SEED     Random seed (default: 77)
 *   ML_TRAINING_WINDOW_MONTHS   History window months (default: 24)
 *   ML_TRAINING_HIGH_RISK_COUNT High-risk cohort count (default: 24)
 *   ML_TRAINING_RUN_PREDICTIVE  true/false (default: true)
 *   ML_TRAINING_RUN_MODELS      true/false (default: true)
 *   ML_TRAINING_PYTHON_EXEC     Python executable (default: python)
 *   ML_TRAINING_MODEL_DIR       Model output dir for training scripts
 */

const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const projectRoot = path.join(__dirname, '..', '..');
const seedScript = path.join(projectRoot, 'scripts', 'seedTestData.js');
const mlBackendDir = path.join(projectRoot, 'machine_learning_backend');

function toBool(value, defaultValue) {
  if (value === undefined || value === null || value === '') return defaultValue;
  return String(value).toLowerCase() !== 'false';
}

function withDbName(uri, dbName) {
  try {
    const parsed = new URL(uri);
    parsed.pathname = `/${dbName}`;
    return parsed.toString();
  } catch (err) {
    // Fallback for malformed URIs: append db name conservatively.
    const cleaned = String(uri || '').replace(/\/+$/, '');
    if (!cleaned) return `mongodb://localhost:27017/${dbName}`;
    return `${cleaned}/${dbName}`;
  }
}

function maskMongoUri(uri) {
  // Avoid printing credentials in logs.
  return String(uri).replace(/:\/\/([^:@/]+):([^@/]+)@/, '://$1:***@');
}

function splitCommandLine(value) {
  const raw = String(value || '').trim();
  if (!raw) return [];
  if (fs.existsSync(raw)) return [raw];
  return (raw.match(/"[^"]+"|'[^']+'|\S+/g) || []).map((part) =>
    part.replace(/^(['"])(.*)\1$/, '$2')
  );
}

function runStep(command, args, options, stepLabel) {
  const result = spawnSync(command, args, options);
  if (result.status !== 0) {
    const cause = result.error ? ` (${result.error.message})` : '';
    throw new Error(`${stepLabel} failed with exit code ${result.status}${cause}`);
  }
}

async function main() {
  const baseUri = process.env.MONGO_URI || 'mongodb://localhost:27017/pms';
  const trainingDbName = process.env.ML_TRAINING_DB_NAME || 'pms_ml_training';
  const trainingUri = process.env.ML_TRAINING_MONGO_URI || withDbName(baseUri, trainingDbName);

  const patientCount = parseInt(process.env.ML_TRAINING_PATIENT_COUNT || '250', 10);
  const randomSeed = parseInt(process.env.ML_TRAINING_RANDOM_SEED || '77', 10);
  const windowMonths = parseInt(process.env.ML_TRAINING_WINDOW_MONTHS || '24', 10);
  const highRiskCount = parseInt(process.env.ML_TRAINING_HIGH_RISK_COUNT || '24', 10);

  const runPredictive = (process.env.ML_TRAINING_RUN_PREDICTIVE === undefined) ? false : toBool(process.env.ML_TRAINING_RUN_PREDICTIVE, true);
  const runModels = toBool(process.env.ML_TRAINING_RUN_MODELS, true);

  // Allow specifying a python launcher with optional args, e.g. "py -3" or a full path
  const pythonExecRaw = process.env.ML_TRAINING_PYTHON_EXEC || 'python';
  const pythonExecParts = splitCommandLine(pythonExecRaw);
  const pythonCommand = pythonExecParts[0];
  const pythonExtraArgs = pythonExecParts.slice(1);
  const modelDir = process.env.ML_TRAINING_MODEL_DIR || path.join(mlBackendDir, 'models');

  console.log('[ML-TRAINING] Starting isolated seed + training pipeline');
  console.log(`[ML-TRAINING] Target DB name: ${trainingDbName}`);
  console.log(`[ML-TRAINING] Target URI: ${maskMongoUri(trainingUri)}`);
  console.log(`[ML-TRAINING] Seed patients: ${patientCount}`);
  console.log(`[ML-TRAINING] Model dir: ${modelDir}`);

  const seedEnv = {
    ...process.env,
    MONGO_URI: trainingUri,
    SEED_PATIENT_COUNT: String(patientCount),
    SEED_RANDOM_SEED: String(randomSeed),
    SEED_WINDOW_MONTHS: String(windowMonths),
    SEED_HIGH_RISK_COUNT: String(highRiskCount),
    SEED_RUN_PREDICTIVE: runPredictive ? 'true' : 'false',
  };

  console.log('[ML-TRAINING] Seeding isolated database...');
  let seeded = false;
  try {
    // Ensure the programmatic seeder uses the isolated database URI.
    process.env.MONGO_URI = trainingUri;
    process.env.SEED_PATIENT_COUNT = String(patientCount);
    process.env.SEED_RANDOM_SEED = String(randomSeed);
    process.env.SEED_WINDOW_MONTHS = String(windowMonths);
    process.env.SEED_HIGH_RISK_COUNT = String(highRiskCount);
    process.env.SEED_RUN_PREDICTIVE = runPredictive ? 'true' : 'false';

    // eslint-disable-next-line global-require, import/no-dynamic-require
    const seedModule = require(path.join(projectRoot, 'scripts', 'seedTestData.js'));
    if (seedModule && typeof seedModule.seedDatabase === 'function' && typeof seedModule.connectDB === 'function') {
      console.log('[ML-TRAINING] Using programmatic seeder (seedDatabase)');
      await seedModule.connectDB();
      await seedModule.seedDatabase({
        patientCount,
        seed: randomSeed,
        windowMonths,
        runPredictive,
      });
      seeded = true;
    }
  } catch (err) {
    console.log('[ML-TRAINING] Programmatic seeder unavailable or failed, falling back to spawning node:', err && err.message);
  }

  if (!seeded) {
    runStep('node', [seedScript], { cwd: projectRoot, env: seedEnv, stdio: 'inherit' }, 'Seeding');
  }

  if (!runModels) {
    console.log('[ML-TRAINING] Skipping model training (ML_TRAINING_RUN_MODELS=false).');
    return;
  }

  const trainingEnv = {
    ...process.env,
    MONGO_URI: trainingUri,
    MONGO_DB_NAME: trainingDbName,
    MODEL_DIR: modelDir,
  };

  const trainingScripts = [
    'training/train_readmission.py',
    'training/train_chronic_risk.py',
    'training/train_lab_forecast.py',
    'training/train_anomaly.py',
  ];

  // Archive existing models if any
  try {
    const fs = require('fs');
    const archiveDir = path.join(mlBackendDir, 'models_archive');
    if (fs.existsSync(path.join(modelDir))) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const dest = path.join(archiveDir, ts);
      fs.mkdirSync(dest, { recursive: true });
      // copy files
      const files = fs.readdirSync(modelDir).filter((f) => f.endsWith('.joblib') || f.endsWith('.pkl') || f === '.gitkeep');
      for (const f of files) {
        const src = path.join(modelDir, f);
        const dst = path.join(dest, f);
        try {
          fs.copyFileSync(src, dst);
        } catch (copyErr) {
          console.warn('[ML-TRAINING] Warning copying file to archive:', copyErr && copyErr.message);
        }
      }
      console.log(`[ML-TRAINING] Archived ${files.length} files to ${dest}`);
    }
  } catch (archiveErr) {
    console.warn('[ML-TRAINING] Failed to archive existing models:', archiveErr && archiveErr.message);
  }

  for (const script of trainingScripts) {
    console.log(`[ML-TRAINING] Running ${script}...`);
    // support extra args from ML_TRAINING_PYTHON_EXEC (e.g. ["py", "-3"]) by prefixing them
    runStep(pythonCommand, [...pythonExtraArgs, script], { cwd: mlBackendDir, env: trainingEnv, stdio: 'inherit' }, `Training ${script}`);
  }

  console.log('[ML-TRAINING] Done. Isolated dataset and model artifacts are ready.');
}

try {
  main();
} catch (err) {
  console.error('[ML-TRAINING] Pipeline failed:', err.message);
  process.exitCode = 1;
}
