# AGRI-DETECT application

AGRI-DETECT is a Django-served crop-health assistant with a vanilla JavaScript frontend and a Python-only ML backend. The browser captures six guided crop photos and sends them to Django for analysis; the result is rendered with crop-specific guidance and saved to local history.

## Current capabilities

- 30-crop catalogue with 317 crop problems.
- Symptoms, causes, step-by-step treatment and risk levels.
- English, Tamil, Hindi, Telugu, Kannada, Malayalam, Bengali and Marathi.
- Offline multilingual chatbot and crop/problem knowledge base.
- Guided six-photo crown capture with blur and not-a-plant safety gates.
- Python image analysis through `/api/ml/predict`.
- Optional trained `.keras` health and disease models.
- Local history, 48-hour recheck reminders, CSV export and Django history sync.
- Optional Gemini vision analysis only when explicitly configured.

## ML architecture

The browser no longer loads TensorFlow.js or model weights. `detection.js` calls two Django endpoints:

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/ml/status` | GET | Reports Python backend and optional model availability. |
| `/api/ml/predict` | POST | Accepts up to six image data URLs and returns risk, confidence and optional disease prediction. |

Python modules:

| File | Purpose |
|---|---|
| `ml/predict.py` | Pillow/NumPy image analysis, optional Keras model inference, prediction aggregation. |
| `ml/train.py` | Trains `ml_models/health.keras` from `healthy/` and `diseased/` image folders. |
| `ml/evaluate.py` | Evaluates a trained health model. |
| `tools/train_disease_classifier.py` | Trains `ml_models/disease.keras` and `disease_classes.json`. |

Without trained models, `/api/ml/predict` uses deterministic Python image signals. This keeps the API usable, but browser-only/offline ML detection is no longer available because inference now requires the Django server.

## Setup

Run from this folder:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python manage.py migrate
python manage.py check
python manage.py test
python manage.py runserver
```

For model training and evaluation:

```powershell
pip install -r requirements-ml.txt
python -m ml.train --data dataset/health --epochs 5
python -m ml.evaluate --data dataset/health
python tools/train_disease_classifier.py --data dataset/disease --epochs 5
```

Set these environment variables to use non-default model locations:

| Variable | Default |
|---|---|
| `AGRI_HEALTH_MODEL` | `ml_models/health.keras` |
| `AGRI_DISEASE_MODEL` | `ml_models/disease.keras` |
| `AGRI_DISEASE_CLASSES` | `ml_models/disease_classes.json` |

## Tests

```powershell
node static/agri/tests/run-tests.js
python -B manage.py check
python -B manage.py test
```

The Node suite validates browser-side pure logic and confirms that `detection.js` contains no TensorFlow.js model code. The Django suite validates pages, static assets, duplicate HTML consistency, history sync and the Python ML API.

## Files

| Path | Purpose |
|---|---|
| `templates/` | Django templates for the five browser pages. |
| `static/agri/` | Browser application, localization data, images, icons and tests. |
| `static/agri/detection.js` | Capture flow and Python ML API client. |
| `static/agri/service-worker.js` | Offline application shell; API routes are bypassed. |
| `core/views.py` | Pages, asset serving, sync API and ML API. |
| `core/urls.py` | Page and API routes before the static catch-all. |
| `ml/` | Python-only inference, training and evaluation. |
| `tools/prepare_feedback_dataset.py` | Converts feedback logs into labeled image folders. |
| `tools/train_disease_classifier.py` | Trains an optional Python disease classifier. |

## License

MIT License. Copyright (c) 2026 N J BALA MANIKANTAN.
