# AGRI-DETECT — Full Development Report

**Repository:** https://github.com/Njbalamani/AGRI-DETECT
**Branch:** `main`
**Maintainer:** N J BALA MANIKANTAN
**Status:** Python-only ML migration implemented and verified.

## 1. Vision and problem

Smallholder farmers in Tamil Nadu often detect crop problems late and lack a fast, trustworthy, local-language source for identification and treatment. AGRI-DETECT provides a phone-light web tool: capture the crop, understand the risk, receive guidance within a 48-hour recheck window, and use the knowledge base in the farmer's own language without app-store installation or sign-up.

## 2. Verified content scale

- **30 crops** across vegetables, fruits, palms, legumes, spices and oilseeds.
- **317 crop problems** with symptoms, causes, step-by-step treatment and risk levels.
- **8 languages** across UI, content, search and chatbot: English, Tamil, Hindi, Telugu, Kannada, Malayalam, Bengali and Marathi.

## 3. Architecture

The frontend is vanilla HTML, CSS and JavaScript served by Django. ML inference runs in Python through Django, not in the browser.

```text
Browser
  -> guided six-photo capture
  -> resize images
  -> /api/ml/predict
  -> Python image analysis and optional Keras models
  -> risk, confidence and optional disease result
  -> crop guidance, local history and 48-hour reminder
```

Key paths:

| Path | Role |
|---|---|
| `core/views.py` | Pages, asset serving, history sync and ML API. |
| `core/urls.py` | Routes for `/api/history/sync`, `/api/ml/status` and `/api/ml/predict`. |
| `ml/predict.py` | Python inference, signal fallback and prediction aggregation. |
| `ml/train.py` | Trains `ml_models/health.keras`. |
| `ml/evaluate.py` | Evaluates trained health models. |
| `tools/prepare_feedback_dataset.py` | Converts feedback into labeled image folders. |
| `tools/train_disease_classifier.py` | Trains `ml_models/disease.keras`. |
| `static/agri/detection.js` | Camera flow and Python ML API client. |
| `static/agri/service-worker.js` | Offline application shell; API routes are bypassed. |

## 4. Completed work

### Data and localization
- 30-crop English master catalogue and seven regional translations.
- Cross-language integrity validated by Node tests.
- Chatbot matches by localized names and tokens, not by array index.
- One language switch updates the full UI and knowledge data.

### Detection and Python ML
- Six-photo guided capture with blur, green-coverage and not-a-plant gates.
- Browser sends data URLs to Django with a maximum of six images per request.
- Python fallback uses Pillow and NumPy when no `.keras` model is present.
- Optional health and disease models are loaded lazily via TensorFlow.
- Result chip distinguishes Python model analysis from local signal analysis.
- TensorFlow.js bundle, browser model files and browser conversion tooling removed.
- Multi-image upload fills the remaining guided slots and warns on blurry photos.
- Result card includes a plain-language explanation of the risk verdict.

### History and PWA
- Local storage history, filters, CSV export and 48-hour recheck markers.
- Risk, crop and zone charts plus zone and date-range filters are available in History.
- Django sync endpoint upserts records by client ID.
- Service worker caches the application shell and bypasses `/api/`.
- Cache version bumped to `agridetect-v50`.

### Documentation and repository
- Root README documents repository structure, Mermaid diagrams, setup and ML commands.
- App README documents Python-only ML architecture and environment variables.
- Test README documents browser test hooks and coverage.
- MIT license uses the exact maintainer name **N J BALA MANIKANTAN**.
- Public repository: `Njbalamani/AGRI-DETECT`.

## 5. Verification evidence

| Check | Command | Result |
|---|---|---|
| Node browser suite | `node static/agri/tests/run-tests.js` | `48 passed, 0 failed` |
| Django configuration | `python manage.py check` | No issues |
| Django full suite | `python manage.py test` | `15 tests OK` |
| Python syntax | `python -m py_compile ml/*.py tools/*.py` | Passed |

## 6. Remaining phases

| Phase | Scope | Status |
|---|---|---|
| Trained model bundle | Add trained `ml_models/health.keras` and optional disease model files. | Pending user dataset/training run |
| Field accuracy validation | Test risk tolerance on real crop photos. | Pending |
| User validation | Three or more real testers and a validation report. | Pending |
| Production deployment | Serve Django behind a production WSGI/ASGI server with HTTPS. | Pending |

## 7. AI usage

AI was used as a divergence partner and implementation accelerator: structuring the crop/problem data model, drafting localized strings, designing offline-friendly matching heuristics and implementing the Python ML migration. Incorrect assumptions were corrected with automated tests, including cross-language index alignment and browser-only ML claims.
