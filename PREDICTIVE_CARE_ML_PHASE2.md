# Predictive Care — Phase 2 Addendum
## Machine Learning Layer (scikit-learn + FastAPI → Node.js)

> This addendum sits on top of the rule-based Phase 1 plan.  
> Phase 1 must be fully working before starting here.  
> Stack added: **Python 3.11 · FastAPI · scikit-learn · pymongo · joblib**

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Your Frontend                        │
└────────────────────────┬────────────────────────────────┘
                         │ HTTP
┌────────────────────────▼────────────────────────────────┐
│           Node.js / Express (existing backend)          │
│                                                         │
│  mlPrediction.service.js  ←──── calls via axios ──────┐ │
│  riskProfile.controller.js (merges ML + rule scores)  │ │
└───────────────────────────────────────────────────────┼─┘
                                                        │ HTTP (internal)
┌───────────────────────────────────────────────────────▼─┐
│              Python FastAPI ML Microservice             │
│              runs on  http://localhost:8000             │
│                                                         │
│  POST /predict/readmission     → Logistic Regression   │
│  POST /predict/chronic-risk    → Random Forest         │
│  POST /predict/lab-forecast    → Linear Regression     │
│  POST /predict/anomaly         → Isolation Forest      │
│  POST /train                   → Retrain all models    │
│  GET  /health                  → Service health check  │
└─────────────────────────────────────────────────────────┘
        │ reads training data
        ▼
┌───────────────────┐
│     MongoDB       │
│  HealthRecord     │
│  Patient          │
│  Appointment      │
│  PatientRiskProfile│
└───────────────────┘
```

**Key rules:**
- Node.js **never** runs ML logic directly — it only calls the Python service
- The Python service **never** writes to MongoDB — Node.js owns all DB writes
- If the Python service is unreachable, Node.js **falls back** to the Phase 1 rule-based scores silently
- ML predictions are stored in `PatientRiskProfile` alongside the rule-based scores for comparison

---

## Folder Structure to Create

```
ml-service/                        ← new top-level folder, sibling to src/
├── main.py                        ← FastAPI entry point
├── requirements.txt
├── .env
├── models/                        ← saved trained model files (.joblib)
│   ├── .gitkeep
├── training/
│   ├── extract_features.py        ← pulls + shapes data from MongoDB
│   ├── train_readmission.py
│   ├── train_chronic_risk.py
│   ├── train_lab_forecast.py
│   └── train_anomaly.py
├── predictors/
│   ├── readmission.py
│   ├── chronic_risk.py
│   ├── lab_forecast.py
│   └── anomaly.py
└── schemas/
    └── request_schemas.py         ← Pydantic input/output shapes
```

And one new file in your Node.js project:
```
src/api/v1/predictive-care/services/
└── mlPrediction.service.js        ← the bridge between Node and Python
```

---

## Phase 2.1 — Python Service Setup

### `requirements.txt`

```
fastapi==0.111.0
uvicorn==0.29.0
scikit-learn==1.4.2
pymongo==4.7.2
pandas==2.2.2
numpy==1.26.4
joblib==1.4.2
python-dotenv==1.0.1
pydantic==2.7.1
```

### `.env`

```
MONGO_URI=mongodb://localhost:27017/pms
MODEL_DIR=./models
PORT=8000
```

---

## Phase 2.2 — Feature Extraction

This is the most important file. It reads your existing MongoDB collections and converts patient records into numeric feature vectors that sklearn can consume.

```python
# ml-service/training/extract_features.py
import os
import numpy as np
import pandas as pd
from pymongo import MongoClient
from datetime import datetime, timedelta
from dotenv import load_dotenv

load_dotenv()

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/pms")
HIGH_RISK_KEYWORDS = [
    "hypertension", "type 2 diabetes", "chronic", "heart failure",
    "copd", "obesity", "renal", "kidney", "coronary", "stroke"
]

def get_db():
    client = MongoClient(MONGO_URI)
    return client["pms"]

def extract_features_for_patient(patient_id: str, db=None) -> dict | None:
    """
    Extracts a flat numeric feature vector for a single patient.
    Returns None if there is insufficient data to build features.
    """
    if db is None:
        db = get_db()

    patient = db.patients.find_one({"patient_id": patient_id})
    if not patient:
        return None

    records = list(db.healthrecords.find({"patient_id": patient_id, "save_state": "final"}))
    appointments = list(db.appointments.find({"patient_id": patient_id}))

    visits   = [r for r in records if r.get("record_type") == "Visit"]
    labs     = [r for r in records if r.get("record_type") == "Lab Result"]
    scripts  = [r for r in records if r.get("record_type") == "Prescription"]

    now = datetime.utcnow()
    cutoff_90  = now - timedelta(days=90)
    cutoff_180 = now - timedelta(days=180)

    # ── Demographics ──────────────────────────────────────────────────────
    dob = patient.get("date_of_birth")
    age = (now - dob).days / 365.25 if dob else 40.0
    gender_male = 1 if patient.get("gender", "").lower() == "male" else 0

    # ── Visit features ────────────────────────────────────────────────────
    total_visits = len(visits)
    visits_90d   = sum(1 for v in visits if _record_date(v) >= cutoff_90)
    visits_180d  = sum(1 for v in visits if _record_date(v) >= cutoff_180)
    urgent_visits = sum(
        1 for v in visits
        if (v.get("details") or {}).get("visitType") in ("Urgent", "Follow-up")
    )

    # Vitals averages (from all visits with valid numbers)
    systolics    = _extract_numeric_details(visits, "visitBpSystolic")
    diastolics   = _extract_numeric_details(visits, "visitBpDiastolic")
    heart_rates  = _extract_numeric_details(visits, "visitHeartRate")
    weights      = _extract_numeric_details(visits, "visitWeight")
    temperatures = _extract_numeric_details(visits, "visitTemperature")

    avg_systolic    = float(np.mean(systolics))    if systolics    else 120.0
    avg_diastolic   = float(np.mean(diastolics))   if diastolics   else 80.0
    avg_heart_rate  = float(np.mean(heart_rates))  if heart_rates  else 72.0
    avg_weight      = float(np.mean(weights))      if weights      else 160.0
    avg_temperature = float(np.mean(temperatures)) if temperatures else 98.6
    high_bp_count   = sum(1 for s in systolics if s >= 140)

    # Diagnosis keyword hits
    all_diagnoses = " ".join([
        (v.get("details") or {}).get("visitAssessment", "").lower() for v in visits
    ])
    chronic_keyword_hits = sum(1 for kw in HIGH_RISK_KEYWORDS if kw in all_diagnoses)

    # ── Lab features ──────────────────────────────────────────────────────
    total_labs      = len(labs)
    abnormal_labs   = sum(1 for l in labs if (l.get("details") or {}).get("labStatus") in ("Abnormal", "Critical"))
    critical_labs   = sum(1 for l in labs if (l.get("details") or {}).get("labStatus") == "Critical")
    abnormal_ratio  = abnormal_labs / total_labs if total_labs else 0.0

    # Most recent glucose value
    glucose_records = [
        l for l in labs
        if "glucose" in (l.get("details") or {}).get("labTestName", "").lower()
    ]
    glucose_records.sort(key=lambda x: _record_date(x))
    last_glucose = _parse_lab_value(
        (glucose_records[-1].get("details") or {}).get("labResultValue", "")
    ) if glucose_records else 100.0

    # ── Appointment features ──────────────────────────────────────────────
    total_appts    = len(appointments)
    completed      = sum(1 for a in appointments if a.get("status") == "Completed")
    completion_rate = completed / total_appts if total_appts else 1.0
    no_show_count  = total_appts - completed

    # ── Prescription features ─────────────────────────────────────────────
    total_scripts  = len(scripts)
    unique_meds    = len(set(
        (s.get("details") or {}).get("medicationName", "unknown") for s in scripts
    ))

    return {
        # Demographics
        "age":                     age,
        "gender_male":             gender_male,
        # Visits
        "total_visits":            total_visits,
        "visits_90d":              visits_90d,
        "visits_180d":             visits_180d,
        "urgent_visits":           urgent_visits,
        # Vitals
        "avg_systolic":            avg_systolic,
        "avg_diastolic":           avg_diastolic,
        "avg_heart_rate":          avg_heart_rate,
        "avg_weight":              avg_weight,
        "avg_temperature":         avg_temperature,
        "high_bp_count":           high_bp_count,
        # Diagnoses
        "chronic_keyword_hits":    chronic_keyword_hits,
        # Labs
        "total_labs":              total_labs,
        "abnormal_labs":           abnormal_labs,
        "critical_labs":           critical_labs,
        "abnormal_ratio":          abnormal_ratio,
        "last_glucose":            last_glucose,
        # Appointments
        "total_appts":             total_appts,
        "completion_rate":         completion_rate,
        "no_show_count":           no_show_count,
        # Prescriptions
        "total_scripts":           total_scripts,
        "unique_meds":             unique_meds,
    }

def extract_all_patients() -> pd.DataFrame:
    """Pulls features for every patient in the database. Used for training."""
    db = get_db()
    patients = list(db.patients.find({}, {"patient_id": 1, "_id": 0}))
    rows = []
    for p in patients:
        features = extract_features_for_patient(p["patient_id"], db)
        if features:
            features["patient_id"] = p["patient_id"]
            rows.append(features)
    return pd.DataFrame(rows)

# ── Helpers ───────────────────────────────────────────────────────────────
def _record_date(record: dict) -> datetime:
    d = record.get("record_date")
    if isinstance(d, datetime):
        return d
    try:
        return datetime.fromisoformat(str(d))
    except Exception:
        return datetime.utcnow()

def _extract_numeric_details(records: list, key: str) -> list:
    values = []
    for r in records:
        raw = (r.get("details") or {}).get(key)
        try:
            values.append(float(raw))
        except (TypeError, ValueError):
            pass
    return values

def _parse_lab_value(raw: str) -> float:
    try:
        return float(str(raw).split()[0])
    except (ValueError, IndexError):
        return 0.0
```

---

## Phase 2.3 — Model Training Scripts

### Readmission Risk — Logistic Regression

```python
# ml-service/training/train_readmission.py
"""
Predicts: will this patient have an urgent/unplanned visit within 90 days?
Label source: derived from visit history (patients who had urgent_visits > 0
in the most recent 90 days are labelled as "readmitted").
"""
import os, joblib
import numpy as np
from extract_features import extract_all_patients
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.metrics import classification_report
from sklearn.utils import resample
from dotenv import load_dotenv

load_dotenv()
MODEL_DIR = os.getenv("MODEL_DIR", "./models")

FEATURES = [
    "age", "gender_male", "total_visits", "visits_90d", "visits_180d",
    "urgent_visits", "avg_systolic", "avg_diastolic", "avg_heart_rate",
    "avg_weight", "avg_temperature", "high_bp_count",
    "chronic_keyword_hits", "total_labs", "abnormal_labs",
    "critical_labs", "abnormal_ratio", "last_glucose",
    "total_appts", "completion_rate", "no_show_count",
    "total_scripts", "unique_meds",
]

def build_labels(df):
    # Label = 1 if patient had urgent visits recently (proxy for readmission)
    return (df["urgent_visits"] > 0).astype(int)

def train():
    print("Extracting features...")
    df = extract_all_patients()

    if len(df) < 10:
        print("Not enough patient data to train. Need at least 10 patients.")
        return

    df["label"] = build_labels(df)
    X = df[FEATURES].fillna(0)
    y = df["label"]

    # Handle class imbalance with upsampling
    df_majority = df[df.label == 0]
    df_minority = df[df.label == 1]
    if len(df_minority) > 0 and len(df_minority) < len(df_majority):
        df_minority_upsampled = resample(
            df_minority, replace=True,
            n_samples=len(df_majority), random_state=42
        )
        df_balanced = pd.concat([df_majority, df_minority_upsampled])
        X = df_balanced[FEATURES].fillna(0)
        y = df_balanced["label"]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y if y.nunique() > 1 else None
    )

    pipeline = Pipeline([
        ("scaler", StandardScaler()),
        ("clf", LogisticRegression(max_iter=1000, class_weight="balanced", random_state=42)),
    ])

    pipeline.fit(X_train, y_train)

    print("\n── Readmission model evaluation ──")
    print(classification_report(y_test, pipeline.predict(X_test), zero_division=0))

    os.makedirs(MODEL_DIR, exist_ok=True)
    joblib.dump(pipeline, os.path.join(MODEL_DIR, "readmission_model.joblib"))
    joblib.dump(FEATURES,  os.path.join(MODEL_DIR, "readmission_features.joblib"))
    print(f"Model saved → {MODEL_DIR}/readmission_model.joblib")

import pandas as pd
if __name__ == "__main__":
    train()
```

---

### Chronic Disease Risk — Random Forest Classifier

```python
# ml-service/training/train_chronic_risk.py
"""
Predicts: Low / Moderate / High / Critical chronic disease risk level.
Label source: derived from chronic_keyword_hits, high_bp_count, critical_labs.
"""
import os, joblib
import pandas as pd
from extract_features import extract_all_patients
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.preprocessing import LabelEncoder
from sklearn.metrics import classification_report
from dotenv import load_dotenv

load_dotenv()
MODEL_DIR = os.getenv("MODEL_DIR", "./models")

FEATURES = [
    "age", "gender_male", "total_visits", "visits_90d",
    "avg_systolic", "avg_diastolic", "avg_heart_rate", "avg_weight",
    "high_bp_count", "chronic_keyword_hits",
    "total_labs", "abnormal_labs", "critical_labs", "abnormal_ratio",
    "last_glucose", "total_scripts", "unique_meds",
]

def build_labels(df):
    # Derive risk labels from feature thresholds as a training proxy
    def label_row(row):
        score = 0
        score += min(row["chronic_keyword_hits"] * 10, 40)
        score += min(row["high_bp_count"] * 6, 30)
        score += min(row["critical_labs"] * 15, 30)
        score += min(row["abnormal_labs"] * 5, 20)
        if score >= 70:   return "Critical"
        if score >= 45:   return "High"
        if score >= 20:   return "Moderate"
        return "Low"
    return df.apply(label_row, axis=1)

def train():
    print("Extracting features...")
    df = extract_all_patients()

    if len(df) < 10:
        print("Not enough data to train.")
        return

    df["label"] = build_labels(df)
    X = df[FEATURES].fillna(0)
    y = df["label"]

    le = LabelEncoder()
    y_enc = le.fit_transform(y)

    X_train, X_test, y_train, y_test = train_test_split(
        X, y_enc, test_size=0.2, random_state=42
    )

    clf = RandomForestClassifier(
        n_estimators=200,
        max_depth=10,
        class_weight="balanced",
        random_state=42,
        n_jobs=-1,
    )
    clf.fit(X_train, y_train)

    print("\n── Chronic risk model evaluation ──")
    print(classification_report(y_test, clf.predict(X_test),
                                target_names=le.classes_, zero_division=0))

    # Feature importance — useful for explaining predictions to clinicians
    importance = sorted(zip(FEATURES, clf.feature_importances_), key=lambda x: -x[1])
    print("\nTop 5 features:")
    for feat, imp in importance[:5]:
        print(f"  {feat}: {imp:.4f}")

    os.makedirs(MODEL_DIR, exist_ok=True)
    joblib.dump(clf,      os.path.join(MODEL_DIR, "chronic_risk_model.joblib"))
    joblib.dump(le,       os.path.join(MODEL_DIR, "chronic_risk_encoder.joblib"))
    joblib.dump(FEATURES, os.path.join(MODEL_DIR, "chronic_risk_features.joblib"))
    print(f"Model saved → {MODEL_DIR}/chronic_risk_model.joblib")

if __name__ == "__main__":
    train()
```

---

### Lab Value Forecast — Linear Regression

```python
# ml-service/training/train_lab_forecast.py
"""
Predicts: the next numeric value for a given lab test (e.g. glucose in 30 days).
One model is trained per test name (Blood glucose, Cholesterol, etc.).
Uses the last N readings as input features.
"""
import os, joblib
import numpy as np
import pandas as pd
from pymongo import MongoClient
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error
from dotenv import load_dotenv

load_dotenv()
MONGO_URI  = os.getenv("MONGO_URI", "mongodb://localhost:27017/pms")
MODEL_DIR  = os.getenv("MODEL_DIR", "./models")
WINDOW     = 3   # use last N readings to predict next

def _parse_value(raw):
    try:
        return float(str(raw).split()[0])
    except (ValueError, IndexError):
        return None

def train():
    client = MongoClient(MONGO_URI)
    db = client["pms"]

    lab_records = list(db.healthrecords.find({
        "record_type": "Lab Result",
        "save_state": "final"
    }, {"patient_id": 1, "record_date": 1, "details": 1}))

    # Group by (patient_id, test_name)
    from collections import defaultdict
    series = defaultdict(list)
    for r in lab_records:
        d = r.get("details") or {}
        test = d.get("labTestName")
        val  = _parse_value(d.get("labResultValue", ""))
        date = r.get("record_date")
        if test and val is not None and date is not None:
            series[(r["patient_id"], test)].append((date, val))

    # Build windowed training data per test name
    by_test = defaultdict(list)
    for (pid, test), readings in series.items():
        readings.sort(key=lambda x: x[0])
        values = [v for _, v in readings]
        for i in range(WINDOW, len(values)):
            window = values[i - WINDOW:i]
            target = values[i]
            by_test[test].append(window + [target])

    os.makedirs(MODEL_DIR, exist_ok=True)
    trained = []

    for test_name, rows in by_test.items():
        if len(rows) < 5:
            continue

        arr = np.array(rows)
        X, y = arr[:, :WINDOW], arr[:, WINDOW]

        if len(X) < 4:
            continue

        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

        model = Pipeline([
            ("scaler", StandardScaler()),
            ("reg",    Ridge(alpha=1.0)),
        ])
        model.fit(X_train, y_train)
        mae = mean_absolute_error(y_test, model.predict(X_test))
        print(f"  {test_name}: MAE = {mae:.2f}")

        safe_name = test_name.lower().replace(" ", "_")
        joblib.dump(model, os.path.join(MODEL_DIR, f"lab_forecast_{safe_name}.joblib"))
        trained.append(test_name)

    # Save the list of available forecast models
    joblib.dump(trained, os.path.join(MODEL_DIR, "lab_forecast_available.joblib"))
    print(f"\nTrained forecasts for: {trained}")

if __name__ == "__main__":
    train()
```

---

### Anomaly Detection — Isolation Forest

```python
# ml-service/training/train_anomaly.py
"""
Detects patients whose vital signs are statistical outliers compared
to the rest of the patient population. No labelled data needed.
"""
import os, joblib
import pandas as pd
from extract_features import extract_all_patients
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline
from dotenv import load_dotenv

load_dotenv()
MODEL_DIR = os.getenv("MODEL_DIR", "./models")

VITALS_FEATURES = [
    "age", "avg_systolic", "avg_diastolic", "avg_heart_rate",
    "avg_weight", "avg_temperature", "abnormal_ratio", "last_glucose",
]

def train():
    print("Extracting features for anomaly model...")
    df = extract_all_patients()

    if len(df) < 10:
        print("Not enough data.")
        return

    X = df[VITALS_FEATURES].fillna(df[VITALS_FEATURES].median())

    model = Pipeline([
        ("scaler", StandardScaler()),
        ("iso",    IsolationForest(
            n_estimators=200,
            contamination=0.1,   # assume ~10% of patients are outliers
            random_state=42,
        )),
    ])
    model.fit(X)

    scores = model.named_steps["iso"].decision_function(
        model.named_steps["scaler"].transform(X)
    )
    print(f"Anomaly score range: {scores.min():.3f} → {scores.max():.3f}")

    os.makedirs(MODEL_DIR, exist_ok=True)
    joblib.dump(model,           os.path.join(MODEL_DIR, "anomaly_model.joblib"))
    joblib.dump(VITALS_FEATURES, os.path.join(MODEL_DIR, "anomaly_features.joblib"))
    print(f"Model saved → {MODEL_DIR}/anomaly_model.joblib")

if __name__ == "__main__":
    train()
```

---

## Phase 2.4 — Pydantic Schemas

```python
# ml-service/schemas/request_schemas.py
from pydantic import BaseModel
from typing import Optional

class PatientFeatures(BaseModel):
    age:                    float
    gender_male:            int
    total_visits:           float
    visits_90d:             float
    visits_180d:            float
    urgent_visits:          float
    avg_systolic:           float
    avg_diastolic:          float
    avg_heart_rate:         float
    avg_weight:             float
    avg_temperature:        float
    high_bp_count:          float
    chronic_keyword_hits:   float
    total_labs:             float
    abnormal_labs:          float
    critical_labs:          float
    abnormal_ratio:         float
    last_glucose:           float
    total_appts:            float
    completion_rate:        float
    no_show_count:          float
    total_scripts:          float
    unique_meds:            float

class ReadmissionRequest(BaseModel):
    patient_id: str
    features: PatientFeatures

class ChronicRiskRequest(BaseModel):
    patient_id: str
    features: PatientFeatures

class LabForecastRequest(BaseModel):
    patient_id:  str
    test_name:   str          # e.g. "Blood glucose"
    last_values: list[float]  # last 3 values in chronological order

class AnomalyRequest(BaseModel):
    patient_id: str
    features: PatientFeatures

class TrainRequest(BaseModel):
    models: Optional[list[str]] = ["all"]
    # e.g. ["readmission", "chronic_risk", "lab_forecast", "anomaly"]
```

---

## Phase 2.5 — Predictor Modules

```python
# ml-service/predictors/readmission.py
import os, joblib
import numpy as np
from dotenv import load_dotenv

load_dotenv()
MODEL_DIR = os.getenv("MODEL_DIR", "./models")

_model    = None
_features = None

def _load():
    global _model, _features
    if _model is None:
        _model    = joblib.load(os.path.join(MODEL_DIR, "readmission_model.joblib"))
        _features = joblib.load(os.path.join(MODEL_DIR, "readmission_features.joblib"))

def predict(features: dict) -> dict:
    _load()
    X = np.array([[features.get(f, 0.0) for f in _features]])
    prob  = float(_model.predict_proba(X)[0][1])   # probability of readmission
    label = "High" if prob >= 0.65 else "Moderate" if prob >= 0.35 else "Low"
    return {
        "readmission_probability": round(prob, 4),
        "readmission_risk_level":  label,
        "readmission_score":       round(prob * 100, 1),
    }
```

```python
# ml-service/predictors/chronic_risk.py
import os, joblib
import numpy as np
from dotenv import load_dotenv

load_dotenv()
MODEL_DIR = os.getenv("MODEL_DIR", "./models")

_model, _encoder, _features = None, None, None

def _load():
    global _model, _encoder, _features
    if _model is None:
        _model    = joblib.load(os.path.join(MODEL_DIR, "chronic_risk_model.joblib"))
        _encoder  = joblib.load(os.path.join(MODEL_DIR, "chronic_risk_encoder.joblib"))
        _features = joblib.load(os.path.join(MODEL_DIR, "chronic_risk_features.joblib"))

def predict(features: dict) -> dict:
    _load()
    X          = np.array([[features.get(f, 0.0) for f in _features]])
    label_enc  = _model.predict(X)[0]
    probs      = _model.predict_proba(X)[0]
    label      = _encoder.inverse_transform([label_enc])[0]
    confidence = float(np.max(probs))

    # Feature importances for explainability
    importances = sorted(
        zip(_features, _model.feature_importances_),
        key=lambda x: -x[1]
    )
    top_factors = [{"feature": f, "importance": round(imp, 4)} for f, imp in importances[:5]]

    return {
        "chronic_risk_level":  label,
        "chronic_risk_score":  round(confidence * 100, 1),
        "confidence":          round(confidence, 4),
        "top_factors":         top_factors,
    }
```

```python
# ml-service/predictors/lab_forecast.py
import os, joblib
import numpy as np
from dotenv import load_dotenv

load_dotenv()
MODEL_DIR = os.getenv("MODEL_DIR", "./models")

_models    = {}
_available = None

def _load_available():
    global _available
    if _available is None:
        try:
            _available = joblib.load(os.path.join(MODEL_DIR, "lab_forecast_available.joblib"))
        except FileNotFoundError:
            _available = []

def _load_model(test_name: str):
    safe = test_name.lower().replace(" ", "_")
    if safe not in _models:
        path = os.path.join(MODEL_DIR, f"lab_forecast_{safe}.joblib")
        if not os.path.exists(path):
            return None
        _models[safe] = joblib.load(path)
    return _models[safe]

def predict(test_name: str, last_values: list) -> dict:
    _load_available()
    model = _load_model(test_name)
    if model is None:
        return {"error": f"No forecast model available for '{test_name}'"}

    # Pad or trim to window size 3
    window = (last_values[-3:] + [0.0] * 3)[:3]
    X = np.array([window])
    predicted = float(model.predict(X)[0])

    trend = "Stable"
    if last_values and predicted > last_values[-1] * 1.10:
        trend = "Rising"
    elif last_values and predicted < last_values[-1] * 0.90:
        trend = "Falling"

    return {
        "test_name":       test_name,
        "predicted_value": round(predicted, 2),
        "trend":           trend,
        "input_window":    window,
        "available_tests": _available,
    }
```

```python
# ml-service/predictors/anomaly.py
import os, joblib
import numpy as np
from dotenv import load_dotenv

load_dotenv()
MODEL_DIR = os.getenv("MODEL_DIR", "./models")

_model, _features = None, None

def _load():
    global _model, _features
    if _model is None:
        _model    = joblib.load(os.path.join(MODEL_DIR, "anomaly_model.joblib"))
        _features = joblib.load(os.path.join(MODEL_DIR, "anomaly_features.joblib"))

def predict(features: dict) -> dict:
    _load()
    X         = np.array([[features.get(f, 0.0) for f in _features]])
    score     = float(_model.decision_function(X)[0])
    is_anomaly = bool(_model.predict(X)[0] == -1)

    # Normalise score to 0–100 range (lower score = more anomalous)
    anomaly_score = round(max(0, min(100, (1 - score) * 50)), 1)

    return {
        "is_anomaly":    is_anomaly,
        "anomaly_score": anomaly_score,  # higher = more unusual
        "raw_score":     round(score, 4),
        "interpretation": "Outlier — vitals significantly deviate from population norms"
                          if is_anomaly else "Within normal population range",
    }
```

---

## Phase 2.6 — FastAPI Main Entry Point

```python
# ml-service/main.py
import os, subprocess, sys
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from schemas.request_schemas import (
    ReadmissionRequest, ChronicRiskRequest,
    LabForecastRequest, AnomalyRequest, TrainRequest
)
from predictors import readmission, chronic_risk, lab_forecast, anomaly
from training.extract_features import extract_features_for_patient

load_dotenv()
app = FastAPI(title="PMS Predictive Care ML Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Health check ──────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok", "service": "predictive-care-ml"}

# ── Convenience: auto-extract features from MongoDB by patient_id ─────────
@app.get("/features/{patient_id}")
def get_features(patient_id: str):
    features = extract_features_for_patient(patient_id)
    if not features:
        raise HTTPException(404, f"Patient {patient_id} not found or has no records")
    return features

# ── Predictions ───────────────────────────────────────────────────────────
@app.post("/predict/readmission")
def predict_readmission(req: ReadmissionRequest):
    try:
        result = readmission.predict(req.features.model_dump())
        return {"patient_id": req.patient_id, **result}
    except FileNotFoundError:
        raise HTTPException(503, "Readmission model not trained yet. POST /train first.")

@app.post("/predict/chronic-risk")
def predict_chronic_risk(req: ChronicRiskRequest):
    try:
        result = chronic_risk.predict(req.features.model_dump())
        return {"patient_id": req.patient_id, **result}
    except FileNotFoundError:
        raise HTTPException(503, "Chronic risk model not trained yet. POST /train first.")

@app.post("/predict/lab-forecast")
def predict_lab_forecast(req: LabForecastRequest):
    result = lab_forecast.predict(req.test_name, req.last_values)
    if "error" in result:
        raise HTTPException(422, result["error"])
    return {"patient_id": req.patient_id, **result}

@app.post("/predict/anomaly")
def predict_anomaly(req: AnomalyRequest):
    try:
        result = anomaly.predict(req.features.model_dump())
        return {"patient_id": req.patient_id, **result}
    except FileNotFoundError:
        raise HTTPException(503, "Anomaly model not trained yet. POST /train first.")

# ── Full prediction for one patient (Node.js calls this) ──────────────────
@app.get("/predict/full/{patient_id}")
def predict_full(patient_id: str):
    """
    Extracts features from MongoDB and runs all 4 models in one call.
    This is the primary endpoint Node.js uses.
    """
    features = extract_features_for_patient(patient_id)
    if not features:
        raise HTTPException(404, f"Patient {patient_id} not found")

    results = {"patient_id": patient_id, "features": features}

    try:
        results["readmission"]   = readmission.predict(features)
    except Exception as e:
        results["readmission"]   = {"error": str(e)}

    try:
        results["chronic_risk"]  = chronic_risk.predict(features)
    except Exception as e:
        results["chronic_risk"]  = {"error": str(e)}

    try:
        results["anomaly"]       = anomaly.predict(features)
    except Exception as e:
        results["anomaly"]       = {"error": str(e)}

    return results

# ── Training ──────────────────────────────────────────────────────────────
@app.post("/train")
def train_models(req: TrainRequest):
    """
    Retrains the specified models (or all of them).
    Runs synchronously — expect 10–60s depending on data size.
    """
    to_train = req.models if req.models != ["all"] else [
        "readmission", "chronic_risk", "lab_forecast", "anomaly"
    ]
    results = {}

    script_map = {
        "readmission":   "training/train_readmission.py",
        "chronic_risk":  "training/train_chronic_risk.py",
        "lab_forecast":  "training/train_lab_forecast.py",
        "anomaly":       "training/train_anomaly.py",
    }

    for name in to_train:
        script = script_map.get(name)
        if not script:
            results[name] = "unknown model"
            continue
        try:
            subprocess.run([sys.executable, script], check=True, capture_output=True)
            results[name] = "trained"
        except subprocess.CalledProcessError as e:
            results[name] = f"failed: {e.stderr.decode()[:200]}"

    return {"trained": results}
```

---

## Phase 2.7 — Node.js Bridge Service

This is the only new file needed in your Node.js project.

```js
// src/api/v1/predictive-care/services/mlPrediction.service.js
const axios = require('axios');

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8000';
const ML_TIMEOUT_MS  = 10000; // 10s — models are fast once loaded

/**
 * Calls the Python ML service for a full prediction on one patient.
 * Returns null (silently) if the ML service is unavailable,
 * allowing Node.js to fall back to rule-based scores.
 */
const getMLPredictionsForPatient = async (patient_id) => {
  try {
    const response = await axios.get(
      `${ML_SERVICE_URL}/predict/full/${patient_id}`,
      { timeout: ML_TIMEOUT_MS }
    );
    return response.data;
  } catch (err) {
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      console.warn(`[ML] Service unavailable — falling back to rule-based scores for ${patient_id}`);
      return null;
    }
    console.error('[ML] Unexpected error:', err.message);
    return null;
  }
};

/**
 * Merges ML predictions into an existing rule-based PatientRiskProfile.
 * ML scores override rule-based scores when available.
 * If ML is unavailable the profile is returned unchanged.
 */
const mergeMLIntoRiskProfile = async (patient_id, ruleBasedProfile) => {
  const ml = await getMLPredictionsForPatient(patient_id);

  if (!ml) return ruleBasedProfile; // ML offline → return unchanged

  const updates = {};

  // Readmission: ML overrides rule-based score
  if (ml.readmission && !ml.readmission.error) {
    updates.readmission_risk      = ml.readmission.readmission_score;
    updates.ml_readmission_prob   = ml.readmission.readmission_probability;
    updates.ml_readmission_level  = ml.readmission.readmission_risk_level;
  }

  // Chronic risk: ML overrides + adds explainability
  if (ml.chronic_risk && !ml.chronic_risk.error) {
    updates.chronic_disease_risk  = ml.chronic_risk.chronic_risk_score;
    updates.ml_chronic_level      = ml.chronic_risk.chronic_risk_level;
    updates.ml_chronic_confidence = ml.chronic_risk.confidence;
    updates.ml_top_risk_factors   = ml.chronic_risk.top_factors;
  }

  // Anomaly flag
  if (ml.anomaly && !ml.anomaly.error) {
    updates.ml_is_anomaly         = ml.anomaly.is_anomaly;
    updates.ml_anomaly_score      = ml.anomaly.anomaly_score;
  }

  updates.ml_computed_at          = new Date();
  updates.ml_service_used         = true;

  // Recompute overall score with ML sub-scores
  const newChronicScore      = updates.chronic_disease_risk ?? ruleBasedProfile.chronic_disease_risk;
  const newReadmissionScore  = updates.readmission_risk     ?? ruleBasedProfile.readmission_risk;
  const newNoShowScore       = ruleBasedProfile.no_show_risk;
  const newOverallScore      = Math.round(newChronicScore * 0.40 + newReadmissionScore * 0.30 + newNoShowScore * 0.15);

  updates.overall_risk_score  = newOverallScore;
  updates.overall_risk_level  = newOverallScore >= 75 ? 'Critical'
                               : newOverallScore >= 50 ? 'High'
                               : newOverallScore >= 25 ? 'Moderate'
                               : 'Low';

  // Persist to MongoDB
  const PatientRiskProfile = require('../models/patientRiskProfile.model');
  return PatientRiskProfile.findOneAndUpdate(
    { patient_id },
    { $set: updates },
    { new: true }
  );
};

/**
 * Fetch a lab forecast from the ML service for a specific test.
 * Returns null if unavailable.
 */
const getLabForecast = async (patient_id, test_name, last_values) => {
  try {
    const response = await axios.post(
      `${ML_SERVICE_URL}/predict/lab-forecast`,
      { patient_id, test_name, last_values },
      { timeout: ML_TIMEOUT_MS }
    );
    return response.data;
  } catch (err) {
    console.warn(`[ML] Lab forecast unavailable for ${test_name}:`, err.message);
    return null;
  }
};

/**
 * Trigger model retraining. Fire-and-forget from Node.js side.
 */
const triggerRetraining = async (models = ['all']) => {
  try {
    const response = await axios.post(
      `${ML_SERVICE_URL}/train`,
      { models },
      { timeout: 120000 } // 2 min for training
    );
    return response.data;
  } catch (err) {
    console.error('[ML] Retraining failed:', err.message);
    return null;
  }
};

module.exports = { getMLPredictionsForPatient, mergeMLIntoRiskProfile, getLabForecast, triggerRetraining };
```

---

## Phase 2.8 — Plug ML into the Existing Controller

Update `riskProfile.controller.js` from Phase 1 to call the ML service after computing rule-based scores:

```js
// In src/api/v1/predictive-care/controllers/riskProfile.controller.js
// Add this import at the top:
const { mergeMLIntoRiskProfile } = require('../services/mlPrediction.service');

// Update computeForPatient to call ML after rule-based:
const computeForPatient = async (req, res) => {
  try {
    const patient = await Patient.findOne({ patient_id: req.params.patientId });
    if (!patient) return res.status(404).json({ message: 'Patient not found.' });

    // Step 1: Run all rule-based engines (Phase 1)
    await Promise.all([
      computeLabTrendsForPatient(patient.patient_id, `${patient.first_name} ${patient.last_name}`),
      computeRiskProfileForPatient(patient),
      checkVaccinationGapsForPatient(patient.patient_id, `${patient.first_name} ${patient.last_name}`),
      computeAdherenceForPatient(patient.patient_id, `${patient.first_name} ${patient.last_name}`),
    ]);

    // Step 2: Fetch rule-based profile
    let profile = await PatientRiskProfile.findOne({ patient_id: patient.patient_id });

    // Step 3: Merge ML predictions on top (falls back gracefully if ML is offline)
    profile = await mergeMLIntoRiskProfile(patient.patient_id, profile);

    res.json({ message: 'Risk profile computed successfully.', profile });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
```

Also add a retraining endpoint to the routes:
```js
// In predictiveCare.routes.js — add:
const { triggerRetraining } = require('../services/mlPrediction.service');

router.post('/ml/retrain', async (req, res) => {
  const result = await triggerRetraining(req.body.models || ['all']);
  res.json(result || { message: 'Retrain triggered (or ML service unavailable)' });
});

router.get('/analytics/:patientId/lab-forecast', async (req, res) => {
  const { test_name, last_values } = req.query;
  if (!test_name) return res.status(400).json({ message: 'test_name is required' });
  const parsed = last_values ? String(last_values).split(',').map(Number) : [];
  const { getLabForecast } = require('../services/mlPrediction.service');
  const result = await getLabForecast(req.params.patientId, test_name, parsed);
  if (!result) return res.status(503).json({ message: 'ML service unavailable' });
  res.json(result);
});
```

---

## Phase 2.9 — New Fields on `PatientRiskProfile`

Add these fields to the schema from Phase 1 to store ML results:

```js
// Add to patientRiskProfile.model.js schema:
ml_readmission_prob:    { type: Number },   // 0.0–1.0
ml_readmission_level:   { type: String },   // Low / Moderate / High
ml_chronic_level:       { type: String },   // Low / Moderate / High / Critical
ml_chronic_confidence:  { type: Number },   // 0.0–1.0
ml_top_risk_factors: [{
  feature:    String,
  importance: Number,
}],
ml_is_anomaly:          { type: Boolean },
ml_anomaly_score:       { type: Number },
ml_computed_at:         { type: Date },
ml_service_used:        { type: Boolean, default: false },
```

---

## Phase 2.10 — Running the Full Stack

### Start the Python ML service

```bash
cd ml-service
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt

# Train models for the first time (run once, then re-run when data grows)
python training/train_readmission.py
python training/train_chronic_risk.py
python training/train_lab_forecast.py
python training/train_anomaly.py

# Start the service
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### Add to Node.js `.env`

```
ML_SERVICE_URL=http://localhost:8000
```

### Install new Node.js dependency

```bash
npm install axios
```

### Verify the bridge is working

```bash
# Health check
curl http://localhost:8000/health

# Full prediction for a patient (use a real patient_id from your DB)
curl http://localhost:8000/predict/full/PAT-20240101-0001

# Trigger from Node.js side
curl -X POST http://localhost:3000/api/v1/predictive-care/profiles/PAT-20240101-0001/compute
```

---

## Updated Frontend API Reference

| Chart / Component | Endpoint | New ML fields available |
|---|---|---|
| Risk score card | `GET /profiles/:patientId` | `ml_readmission_level`, `ml_chronic_level`, `ml_is_anomaly` |
| Risk radar chart | `GET /analytics/:patientId/risk-radar` | ML-overridden `readmission_risk`, `chronic_disease_risk` |
| Lab forecast line | `GET /analytics/:patientId/lab-forecast?test_name=Blood+glucose&last_values=120,135,148` | `predicted_value`, `trend` |
| Explainability panel | `GET /profiles/:patientId` | `ml_top_risk_factors: [{ feature, importance }]` — render as horizontal bar chart |
| Anomaly badge | `GET /profiles/:patientId` | `ml_is_anomaly`, `ml_anomaly_score` |
| Retrain trigger (admin) | `POST /predictive-care/ml/retrain` | — |

---

## Full Build Order (Phase 1 + Phase 2 combined)

```
Phase 1.1   Create 4 MongoDB models
Phase 1.2   Build 5 rule-based services
Phase 1.3   Build 3 controllers
Phase 1.4   Add validators
Phase 1.5   Wire routes into app.js
Phase 1.6   Add nightly cron job
──────────────── Phase 1 working ────────────────
Phase 2.1   Create ml-service/ folder and install Python deps
Phase 2.2   Write extract_features.py
Phase 2.3   Write all 4 training scripts and run them once
Phase 2.4   Write Pydantic schemas
Phase 2.5   Write 4 predictor modules
Phase 2.6   Write FastAPI main.py and start the service
Phase 2.7   Write mlPrediction.service.js in Node.js
Phase 2.8   Update riskProfile.controller.js to call ML service
Phase 2.9   Add ML fields to PatientRiskProfile schema
Phase 2.10  Run full stack and test with curl
Phase 2.11  Connect new ML fields to frontend charts
```
