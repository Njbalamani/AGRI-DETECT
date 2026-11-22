# AGRI-DETECT browser test suite

The browser tests are a zero-dependency Node runner for the real JavaScript files in `static/agri/`. They stub the DOM, canvas, image loading, local storage and network access, so no browser, camera or server is required.

Run from the repository root:

```powershell
node static/agri/tests/run-tests.js
```

Current result: `48 passed, 0 failed`.

## Coverage

| Area | What is verified |
|---|---|
| Shared helpers | HTML escaping, placeholder replacement and DOM key filling. |
| Knowledge base | Crop search, problem lookup, legacy solution format and language fallback. |
| History | Storage schema, corrupt-data safety, filters, labels, CSV quoting and follow-up state. |
| Detection | Health thresholds, JSON parsing, pixel health scoring and safety gates. |
| Python ML client | `predictFromApi()` fails safely when the API is unreachable. |
| Localization | New UI keys resolve in all eight languages. |
| Chatbot | Query normalization, answer indexing, intents and provider gating. |
| Sync client | Merge behavior and safe failure without `fetch`. |

The suite also reads `detection.js` directly and asserts that browser model code is gone: no `tf.min.js`, no `tensor`, and no `tf.loadGraphModel`.

## Test hooks

`detection.js` exposes a small `window.agriTest` object only for this runner:

| Hook | Purpose |
|---|---|
| `setShots(arr)` | Inject synthetic photo data URLs. |
| `getShots()` | Read injected photos. |
| `localAnalyse(ml)` | Run local analysis with an optional Python API result. |
| `imageHealthScore(dataUrl)` | Run single-photo pixel analysis. |
| `predictFromApi(dataUrls)` | Call the Python ML API; resolves `null` when unavailable. |
| `healthToRisk(score)` | Map score to risk and confidence. |
| `extractJson(text)` | Parse JSON embedded in model text. |
| `parseVisionJson(value)` | Normalize optional Gemini vision output. |
| `resizeDataUrl(dataUrl)` | Verify resize behavior with stubbed canvases. |
| `currentSteps()` | Read capture steps. |
| `cropFromQuery()`, `cropLabel()`, `cropGuidance()` | Crop query parsing and guidance. |
| `visionAnalyse()` | Verify provider gating. |
| `detectionCfg()` | Read saved AI configuration. |
| `saveToHistory()` | Persist a result through the history module. |
| `modelStatus()` | Report Python backend status. |
| `classifyDisease(dataUrl)` | Return optional disease data from Python; fails safely. |

No rendering, camera or real network path is exposed.
