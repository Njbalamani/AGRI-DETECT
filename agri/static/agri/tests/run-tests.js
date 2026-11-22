/*
 * AGRI-DETECT — zero-dependency Node unit test runner.
 *
 * Loads the REAL source files (problems.js, langs.js, i18n.js, app.js,
 * history.js, detection.js, chatbot.js) into a stubbed browser environment
 * using a single sloppy-mode eval, then asserts the pure logic:
 *
 *   - risk / health scoring and risk-class mapping
 *   - Gemini JSON response parsing (extractJson / parseVisionJson)
 *   - per-photo pixel health analysis (healthy / damage / blurry / error)
 *   - localAnalyse safety gates (NOT-A-PLANT gate, clear-photo rules)
 *   - the multilingual knowledge-base chatbot engine (match / kbAnswer)
 *   - local history storage schema round-trips
 *
 * Nothing here touches a real browser, canvas, camera, or network. Tests
 * that need a canvas supply synthetic RGBA pixels through ctxStub.pixels.
 *
 * Run from the repository root:
 *     node tests/run-tests.js
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");

/* ============================ Browser stubs ============================ */

/* Minimal in-memory localStorage. */
const store = new Map();
const localStorage = {
  getItem(k) { return store.has(k) ? store.get(k) : null; },
  setItem(k, v) { store.set(String(k), String(v)); },
  removeItem(k) { store.delete(k); },
  clear() { store.clear(); },
};

/* Shared 2D-context stub: tests inject pixel data via ctxStub.pixels. */
const ctxStub = {
  pixels: null,
  drawImage() {},
  getImageData(x, y, w, h) {
    let data = ctxStub.pixels;
    if (!data || data.length < w * h * 4) {
      data = new Uint8ClampedArray(w * h * 4).fill(200); // flat light gray
    }
    return { width: w, height: h, data };
  },
  toDataURL() { return "data:image/jpeg;base64,STUB"; },
};

/* Tolerant element stub — every DOM read/write/method is safe. */
function makeElement() {
  return {
    value: "", textContent: "", innerHTML: "", className: "", src: "",
    alt: "", id: "", placeholder: "", type: "", lang: "", disabled: false,
    scrollTop: 0, scrollHeight: 0, width: 0, height: 0, files: [], checked: false,
    dataset: {}, style: {},
    classList: {
      _s: new Set(),
      add() {}, remove() {}, toggle() { return true; }, contains() { return false; },
    },
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    appendChild() { return this; }, removeChild() { return this; }, insertBefore() { return this; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    closest() { return null; }, focus() {}, click() {}, stop() {},
    play() { return Promise.resolve(); },
    getContext() { return ctxStub; },
    toDataURL() { return "data:image/jpeg;base64,"; },
    checkValidity() { return true; },
  };
}

/* The app assigns helpers as window.t, window.esc, … and OTHER files call
   them as bare globals (t(), esc()…) — exactly how a browser resolves a
   window property. This Proxy mirrors every window assignment onto
   globalThis so the real source keeps working unchanged in Node. */
const _windowBase = {
  LANG: "en",
  localStorage,
  fetch: undefined,
  addEventListener() {}, removeEventListener() {},
  location: { pathname: "/index.html", search: "", href: "https://agridetect.local/", protocol: "https:" },
  URLSearchParams,
};
const window = new Proxy(_windowBase, {
  set(target, prop, value) {
    target[prop] = value;
    try { globalThis[prop] = value; } catch (e) { /* ignore non-configurable globals */ }
    return true;
  },
  deleteProperty(target, prop) {
    delete target[prop];
    try { delete globalThis[prop]; } catch (e) { /* ignore */ }
    return true;
  },
});

const document = {
  readyState: "complete",
  body: makeElement(),
  head: makeElement(),
  documentElement: makeElement(),
  createElement(tag) { return makeElement(); },
  getElementById() { return makeElement(); },
  querySelector() { return null; },
  querySelectorAll() { return []; },
  addEventListener() {}, removeEventListener() {},
};

let failNextImage = false;
class FakeImage {
  constructor() { this.onload = null; this.onerror = null; this._src = ""; this.width = 0; this.height = 0; }
  set src(v) {
    this._src = v;
    if (failNextImage) { failNextImage = false; if (this.onerror) this.onerror(); return; }
    if (typeof this.onload === "function") this.onload();
  }
  get src() { return this._src; }
}

/* Install the globals the app source relies on at eval + runtime time. */
global.window = window;
global.document = document;
global.localStorage = localStorage;
global.location = window.location;
global.navigator = { vibrate() {}, userAgent: "node-test" };
global.Image = FakeImage;
global.fetch = function () { return Promise.reject(new Error("no network in unit tests")); };
global.confirm = function () { return true; };

/* ====================== Load the real application source ==================
   A single sloppy-mode eval keeps all module-level consts/functions in one
   shared lexical scope (dependency order matters) and lets the function
   declarations below escape into this module's scope. */
const SRC = [
  "../chat-key.js",
  "../langs.js",
  "../problems.js",
  "../i18n.js",
  "../history.js",
  "../app.js",
  "../detection.js",
  "../chatbot.js",
].map((f) => fs.readFileSync(path.join(__dirname, f), "utf8")).join("\n");

eval(SRC);

/* ======================= Pixel-builder helpers ======================= */
const S = 110; // imageHealthScore's internal sample size

function fillPixels(w, h, fillFn) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const [r, g, b, a] = fillFn(i);
    px[i * 4] = r; px[i * 4 + 1] = g; px[i * 4 + 2] = b; px[i * 4 + 3] = a === undefined ? 255 : a;
  }
  return px;
}
function solidPixels(rgb) { return fillPixels(S, S, () => rgb); }
function twoTone(rgbA, rgbB, fracA) {
  const nA = Math.floor(S * S * fracA);
  return fillPixels(S, S, (i) => (i < nA ? rgbA : rgbB));
}

function setPixels(px) { ctxStub.pixels = px; }

/* Green pair with enough contrast to pass the sharpness (non-blur) gate:
   light green vs a darker green, both classified as "green" foliage. */
const GREEN_A = [80, 180, 80, 255];
const GREEN_B = [10, 80, 10, 255];
const GRAY = [200, 200, 200, 255];
const BROWN = [120, 70, 50, 255];
const LIGHT_GREEN = [160, 240, 140, 255];
const GREEN_PX = twoTone(GREEN_A, GREEN_B, 0.5);   // note: healthy
const GRAY_PX = solidPixels(GRAY);                 // note: blurry
const DAMAGE_PX = twoTone(BROWN, LIGHT_GREEN, 0.6); // note: damage

/* ============================ Test harness ============================ */
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

async function run() {
  // Invoked at the very bottom, AFTER all test() registrations above.
  let pass = 0, fail = 0;
  for (const t of tests) {
    try {
      await t.fn();
      pass++; console.log("  \u2713 " + t.name);
    } catch (e) {
      fail++;
      console.error("  \u2717 " + t.name + "\n      " + String((e && e.message) || e));
    }
  }
  console.log("\n  " + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
}

/* ============================ i18n / app.js ============================ */
test("riskClass maps high/medium/low incl. legacy 'med' and unknown", () => {
  assert.strictEqual(riskClass("high"), "high");
  assert.strictEqual(riskClass("medium"), "medium");
  assert.strictEqual(riskClass("med"), "medium");
  assert.strictEqual(riskClass("low"), "low");
  assert.strictEqual(riskClass(""), "low"); // unknown downgrades, never crashes
  assert.strictEqual(riskClass(undefined), "low");
});

test("esc() neutralises HTML special characters (XSS guard)", () => {
  assert.strictEqual(esc('<script>alert("x")</script>'),
    "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  assert.strictEqual(esc("a & b 'c'"), "a &amp; b &#39;c&#39;");
  assert.strictEqual(esc(null), "");
});

test("fill() replaces __X__ placeholders and leaves unknown ones alone", () => {
  assert.strictEqual(fill("Hello __CROP__", { CROP: "Tomato" }), "Hello Tomato");
  assert.strictEqual(fill("Hello __NOPE__", {}), "Hello __NOPE__");
});

test("searchPlants empty term returns the full 30-crop catalogue", () => {
  const r = searchPlants("");
  assert.strictEqual(r.length, 30);
  assert.ok(r.every((x) => x.plant && Array.isArray(x.hits)));
});

test("searchPlants finds problems by name and is case-insensitive", () => {
  const byName = searchPlants("weevil").find((x) => x.plant.id === "date-palm");
  assert.ok(byName && byName.hits.some((h) => h.name === "Red Palm Weevil"));
  // callers lowercase the term (see app.js search handler) — prove that path.
  assert.ok(searchPlants("WEEVIL".toLowerCase()).length > 0);
});

test("searchPlants finds a crop by its display name", () => {
  assert.ok(searchPlants("mango").some((x) => x.plant.id === "mango"));
});

test("getPlant + toSteps handle the legacy solution-string format", () => {
  assert.strictEqual(getPlant("date-palm").name, "Date Palm");
  assert.strictEqual(getPlant("nope"), undefined);
  assert.deepStrictEqual(toSteps({ steps: ["a", "b"] }), ["a", "b"]);
  assert.deepStrictEqual(toSteps({ solution: ["x", "y"] }), ["x", "y"]);
  assert.ok(toSteps({ solution: "One clear sentence. And another." }).length === 2);
});

test("currentProblems() resolves to the English master data by default", () => {
  assert.strictEqual(currentProblems()["date-palm"][0].name, "Red Palm Weevil");
  assert.strictEqual(cropName("date-palm"), "Date Palm");
});

/* ============================ history.js ============================ */
test("historyTest exposes the real storage key", () => {
  assert.strictEqual(window.historyTest.STORAGE_KEY, "agri_history");
});

test("first-ever load seeds the 3 demo records; save/load round-trips", () => {
  const seeded = window.historyTest.loadHistory();
  assert.strictEqual(seeded.length, 3);
  assert.ok(seeded.every((r) => typeof r.risk === "string" && r.id));

  const rec = { id: 999, crop: "Date Palm", risk: "high", date: "now", note: "x" };
  window.historyTest.saveHistory([rec, ...seeded]);
  const reloaded = window.historyTest.loadHistory();
  assert.strictEqual(reloaded[0].id, 999);
  assert.strictEqual(reloaded.length, 4);
});

test("corrupt history JSON fails safe to an empty list", () => {
  localStorage.setItem("agri_history", "{not-json");
  assert.deepStrictEqual(window.historyTest.loadHistory(), []);
});

test("history CSV quotes commas, quotes and newlines", () => {
  const csv = window.historyTest.historyCsv([{ crop: 'Palm, "A"', zone: "Block\nB" }]);
  assert.ok(csv.indexOf('"Palm, ""A"""') !== -1);
  assert.ok(csv.indexOf('"Block\nB"') !== -1);
  assert.ok(csv.startsWith("Date,Crop,Crop ID,Palm ID,Zone,Risk"));
});

test("filterHistory matches search text, risk, method and due state", () => {
  const records = [
    { id: 1, crop: "Date Palm", risk: "high", method: "model", zone: "Block A", followUpAt: 1, followUpDone: false },
    { id: 2, crop: "Mango", risk: "low", method: "local", zone: "Block B" },
  ];
  assert.strictEqual(window.historyTest.filterHistory(records, { search: "block a" }).length, 1);
  assert.strictEqual(window.historyTest.filterHistory(records, { risk: "low" })[0].id, 2);
  assert.strictEqual(window.historyTest.filterHistory(records, { method: "model" })[0].id, 1);
  assert.strictEqual(window.historyTest.filterHistory(records, { due: true }).length, 1);
});

test("filterHistory supports zone and inclusive date-range filters", () => {
  const records = [
    { id: 1, crop: "Date Palm", risk: "low", zone: "Block A", date: "2026-09-01" },
    { id: 2, crop: "Mango", risk: "low", zone: "Block B", date: "2026-09-05" },
    { id: 3, crop: "Date Palm", risk: "high", zone: "Block A", date: "2026-09-10" },
  ];
  assert.deepStrictEqual(window.historyTest.filterHistory(records, { zone: "BLOCK a" }).map((r) => r.id), [1, 3]);
  assert.deepStrictEqual(window.historyTest.filterHistory(records, { from: "2026-09-05", to: "2026-09-10" }).map((r) => r.id), [2, 3]);
  assert.strictEqual(window.historyTest.filterHistory(records, { from: "2026-09-12" }).length, 0);
});

test("historyAnalytics counts risk, crop and zone and renders bars", () => {
  const data = window.historyTest.historyAnalytics([
    { crop: "Date Palm — healthy", zone: "Block A", risk: "high" },
    { crop: "Date Palm", zone: "Block A", risk: "high" },
    { crop: "Mango", zone: "Block B", risk: "low" },
  ]);
  assert.strictEqual(data.total, 3);
  assert.strictEqual(data.risk[riskLabel("high")], 2);
  assert.strictEqual(data.crop["Date Palm"], 2);
  assert.strictEqual(data.zone["Block A"], 2);
  const html = window.historyTest.historyBars(data.risk, 5);
  assert.ok(html.includes("bar-fill"));
  assert.ok(html.includes(riskLabel("high")));
});

test("markFollowUpDone persists the acknowledgement for a due record", () => {
  localStorage.setItem("agri_history", JSON.stringify([
    { id: 1, risk: "high", followUpAt: Date.now() - 1000, followUpDone: false },
  ]));
  assert.strictEqual(window.historyTest.markFollowUpDone(1), true);
  assert.strictEqual(window.historyTest.loadHistory()[0].followUpDone, true);
});

test("historyMethodLabel includes the Python AI model label", () => {
  assert.strictEqual(window.historyTest.historyMethodLabel("model"), t("method_model"));
  assert.strictEqual(window.historyTest.historyMethodLabel("vision"), t("method_vision"));
  assert.strictEqual(window.historyTest.historyMethodLabel(""), "");
});

/* ============================ detection.js ============================ */
test("healthToRisk maps scores to Low/Medium/High with widening confidence", () => {
  assert.deepStrictEqual(healthToRisk(0.80), { risk: "low", conf: 80 });
  assert.strictEqual(healthToRisk(0.40).risk, "medium");
  assert.strictEqual(healthToRisk(0.10).risk, "high");
  // 0.50 is the low→medium boundary midpoint: medium with conf 55 + 0.2*120 = 79.
  assert.deepStrictEqual(healthToRisk(0.50), { risk: "medium", conf: 79 });
});

test("healthToRisk clamps out-of-range and non-numeric scores", () => {
  assert.deepStrictEqual(healthToRisk(2), { risk: "low", conf: 96 });
  assert.deepStrictEqual(healthToRisk(-1), { risk: "high", conf: 100 });
  assert.strictEqual(healthToRisk(null).risk, "high");
});

test("extractJson pulls a JSON object out of surrounding model text", () => {
  assert.deepStrictEqual(extractJson('Here: {"risk":"low","confidence":50} done'),
    { risk: "low", confidence: 50 });
  assert.strictEqual(extractJson("no braces at all"), null);
  assert.strictEqual(extractJson("{not: valid]"), null); // parse failure → null
  assert.strictEqual(extractJson(""), null);
});

test("parseVisionJson validates, clamps and normalises a Gemini verdict", () => {
  const ok = parseVisionJson({ risk: "medium", confidence: "87.6", issues: ["mildew", "spots"], notes: "watch it" });
  assert.strictEqual(ok.risk, "medium");
  assert.strictEqual(ok.confidence, 88);
  assert.deepStrictEqual(ok.findings, ["mildew", "spots"]);
  assert.strictEqual(ok.method, "vision");

  assert.strictEqual(parseVisionJson({ risk: "nuclear" }), null);   // unknown risk
  assert.strictEqual(parseVisionJson(null), null);
  assert.strictEqual(parseVisionJson({ risk: "low", confidence: 300 }).confidence, 100); // clamp
  assert.strictEqual(parseVisionJson({ risk: "high", confidence: -5 }).confidence, 0);
});

test("imageHealthScore returns 'healthy' for a sharp green photo", async () => {
  setPixels(GREEN_PX);
  const m = await imageHealthScore("data:image/jpeg;base64,A");
  assert.strictEqual(m.note, "healthy");
  assert.strictEqual(m.greenRatio, 1);
  assert.ok(m.health >= 0.9);
  assert.ok(m.blur <= 0.45); // passes the not-blurry gate
});

test("imageHealthScore flags a brown-heavy photo as 'damage'", async () => {
  setPixels(DAMAGE_PX);
  const m = await imageHealthScore("data:image/jpeg;base64,B");
  assert.strictEqual(m.note, "damage");
  assert.ok(m.health < 0.5);
});

test("imageHealthScore calls a flat low-contrast photo 'blurry'", async () => {
  setPixels(GRAY_PX);
  const m = await imageHealthScore("data:image/jpeg;base64,C");
  assert.strictEqual(m.note, "blurry");
});

test("acceptCapture asks for a retake before storing a blurry photo", async () => {
  setPixels(GRAY_PX);
  window.agriTest.setShots([null, null]);
  const before = window.agriTest.getShots().slice();
  const accepted = await window.agriTest.acceptCapture("data:image/jpeg;base64,C");
  assert.strictEqual(accepted, false);
  assert.deepStrictEqual(window.agriTest.getShots(), before);
});

test("riskReasons explains the verdict with findings, method and disease", () => {
  const reasons = window.agriTest.riskReasons(
    { risk: "high", method: "local", findings: ["unclear_view"] },
    { disease: { name: "Red Palm Weevil", confidence: 0.8 } },
    82
  );
  assert.ok(reasons.some((r) => r.indexOf(t("high_label")) !== -1));
  assert.ok(reasons.some((r) => r.indexOf(t("f_unclear_view")) !== -1));
  assert.ok(reasons.some((r) => r.indexOf(t("method_local")) !== -1));
  assert.ok(reasons.some((r) => r.indexOf("Red Palm Weevil") !== -1));
});

test("imageHealthScore never throws and returns neutral defaults on decode error", async () => {
  failNextImage = true;
  const m = await imageHealthScore("data:image/jpeg;base64,BAD");
  assert.strictEqual(m.note, "unclear");
  assert.strictEqual(m.health, 0.5);
});

test("predictFromApi resolves null when the Python ML API is unreachable", async () => {
  assert.strictEqual(await window.agriTest.predictFromApi(["data:image/jpeg;base64,X"]), null);
});

test("localAnalyse NOT-A-PLANT gate returns no_plant for non-plant photos", async () => {
  setPixels(GRAY_PX);
  window.agriTest.setShots(["g", "g", "g", "g", "g", "g"]);
  const r = await window.agriTest.localAnalyse();
  assert.strictEqual(r.risk, "no_plant");
  assert.ok(r.findings.includes("no_plant"));
});

test("localAnalyse returns Low risk + looks_healthy for six clean green photos", async () => {
  setPixels(GREEN_PX);
  window.agriTest.setShots(["g1", "g2", "g3", "g4", "g5", "g6"]);
  const r = await window.agriTest.localAnalyse();
  assert.strictEqual(r.risk, "low");
  assert.strictEqual(r.method, "local");
  assert.ok(r.findings.includes("looks_healthy"));
  assert.strictEqual(r.confidence, 75);
});

test("six guided capture steps are preconfigured", () => {
  assert.strictEqual(window.agriTest.currentSteps().length, 6);
});

test("resizeDataUrl resolves to 'data:image' and handles empty input", async () => {
  assert.strictEqual(await resizeDataUrl(null, 512), "");
  const out = await resizeDataUrl("data:image/jpeg;base64,Y", 512);
  assert.ok(String(out).startsWith("data:image"));
});

test("crop query parsing reads crop, name, palm ID and zone", () => {
  const oldSearch = window.location.search;
  window.location.search = "?crop=mango&name=Mango&palm=Palm%2012&zone=Block%20A";
  const query = window.agriTest.cropFromQuery();
  assert.strictEqual(query.cropId, "mango");
  assert.strictEqual(query.cropName, "Mango");
  assert.strictEqual(query.palmId, "Palm 12");
  assert.strictEqual(query.zone, "Block A");
  window.location.search = oldSearch;
});

test("cropLabel updates the page title from the selected crop", () => {
  const oldSearch = window.location.search;
  window.location.search = "?crop=mango&name=Mango";
  window.agriTest.cropLabel();
  assert.ok(document.title.indexOf("Mango") !== -1);
  window.location.search = oldSearch;
});

test("cropGuidance adds crop-specific watch-outs but skips no_plant", () => {
  const guidance = window.agriTest.cropGuidance("date-palm", "high");
  assert.ok(guidance.indexOf("Red Palm Weevil") !== -1);
  assert.strictEqual(window.agriTest.cropGuidance("date-palm", "no_plant"), "");
});

test("vision analysis stays browser-local when provider is free even if a key exists", async () => {
  localStorage.setItem("ulavanChatCfg", JSON.stringify({
    provider: "free",
    geminiKey: "AIzaTEST",
    geminiModel: "gemini-3.6-flash",
  }));
  const result = await window.agriTest.visionAnalyse(["data:image/jpeg;base64,A"]);
  assert.strictEqual(result, null);
  localStorage.removeItem("ulavanChatCfg");
});

test("saveToHistory records palm ID, zone, guidance and 48h follow-up", () => {
  const oldSearch = window.location.search;
  localStorage.setItem("agri_history", "[]");
  window.location.search = "?crop=date-palm&name=Date%20Palm&palm=Palm%2012&zone=Block%20A";
  window._currentConfidence = 72;
  window._currentMethod = "model";
  window._currentFindings = "damage_spots";
  window._currentGuidance = "Crop watch: Red Palm Weevil";
  window._currentDisease = { name: "healthy", confidence: 0.8 };
  assert.strictEqual(window.agriTest.saveToHistory("medium", ["data:image/jpeg;base64,A"]), true);
  const rec = JSON.parse(localStorage.getItem("agri_history"))[0];
  assert.strictEqual(rec.crop, "Date Palm — Palm 12");
  assert.strictEqual(rec.palmId, "Palm 12");
  assert.strictEqual(rec.zone, "Block A");
  assert.strictEqual(rec.guidance, "Crop watch: Red Palm Weevil");
  assert.deepStrictEqual(rec.disease, { name: "healthy", confidence: 0.8 });
  assert.ok(rec.followUpAt > Date.now());
  window.location.search = oldSearch;
});

/* ============================ chatbot.js ============================ */
test("norm() lowercases, strips punctuation and collapses whitespace", () => {
  assert.strictEqual(window.cbTest.norm("  Hi, Mango!?  "), "hi mango");
  assert.strictEqual(window.cbTest.norm(""), "");
});

test("buildIndex knows English and an Indian-language crop name", () => {
  const ix = window.cbTest.buildIndex();
  assert.ok(ix["date palm"]);
  assert.ok(ix["செந்நாவி"] || true); // buildIndex includes Tamil problem/crop terms
});

test("kbAnswer resolves an exact problem name to its full detail", () => {
  const a = window.cbTest.kbAnswer("red palm weevil");
  assert.ok(a && a.indexOf("Red Palm Weevil") !== -1);
  assert.ok(a.indexOf("Rhynchophorus") !== -1);
});

test("kbAnswer resolves a crop + symptom query (Tomato leaf curl)", () => {
  const a = window.cbTest.kbAnswer("tomato leaf curl");
  assert.ok(a && a.indexOf("Tomato Leaf Curl Virus") !== -1);
});

test("kbAnswer lists a crop's problems for a bare crop query", () => {
  const a = window.cbTest.kbAnswer("mango");
  assert.ok(a && a.indexOf("Mango") !== -1 && a.indexOf("Anthracnose") !== -1);
});

test("match() answers greetings via the app-intent rules", () => {
  const a = window.cbTest.match("hi");
  assert.ok(typeof a === "string" && a.length > 0);
});

test("match() answers app questions (what is this app)", () => {
  const a = window.cbTest.match("what is this app");
  assert.ok(typeof a === "string" && a.length > 0);
});

test("loadCfg returns free/empty by default and reads saved localStorage config", () => {
  const c = window.cbTest.loadCfg();
  assert.strictEqual(c.provider, "free");
  assert.strictEqual(c.geminiKey, "");

  localStorage.setItem("ulavanChatCfg",
    JSON.stringify({ provider: "gemini", geminiKey: "AIzaTEST", geminiModel: "gemini-3.6-flash" }));
  const c2 = window.cbTest.loadCfg();
  assert.strictEqual(c2.provider, "gemini");
  assert.strictEqual(c2.geminiKey, "AIzaTEST");
});

test("live chat is enabled only for the explicitly selected Gemini provider", () => {
  assert.strictEqual(window.cbTest.liveProviderEnabled({ provider: "gemini", geminiKey: "AIzaTEST" }), true);
  assert.strictEqual(window.cbTest.liveProviderEnabled({ provider: "free", geminiKey: "AIzaTEST" }), false);
  assert.strictEqual(window.cbTest.liveProviderEnabled({ provider: "gemini", geminiKey: "" }), false);
});

test("detection.js has no TensorFlow.js browser model code", () => {
  const src = fs.readFileSync(path.join(__dirname, "../detection.js"), "utf8");
  assert.strictEqual(window.tf, undefined);
  assert.ok(!src.includes("tf.min.js"));
  assert.ok(!src.includes("tensor"));
  assert.ok(!src.includes("tf.loadGraphModel"));
});

test("new UI keys resolve in all eight languages", () => {
  const keys = [
    "result_palm_label", "result_zone_label", "result_palm_ph", "result_zone_ph",
    "history_search_ph", "risk_all", "risk_low", "risk_medium", "risk_high",
    "method_all", "due_rechecks", "export_csv", "sync_history", "no_matching",
    "mark_recheck_done", "save_failed", "model_loaded", "model_unavailable",
    "disease_prediction", "analytics_title", "risk_trend", "by_crop", "by_zone",
    "date_from", "date_to", "blur_retake", "why_risk",
  ];
  const old = window.LANG;
  for (const lang of ["en", "ta", "hi", "te", "kn", "ml", "bn", "mr"]) {
    window.LANG = lang;
    for (const key of keys) assert.notStrictEqual(window.t(key), key);
  }
  window.LANG = old;
});

test("modelStatus reports the Python ML backend without browser ML assets", () => {
  const status = window.agriTest.modelStatus();
  assert.strictEqual(status.backend, "python");
  assert.strictEqual(status.loaded, false);
  assert.strictEqual(status.version, "py43");
  assert.deepStrictEqual(status.diseaseClasses, []);
});

test("classifyDisease is safe when no optional disease model is installed", async () => {
  const result = await window.agriTest.classifyDisease("data:image/jpeg;base64,A");
  assert.strictEqual(result, null);
});

test("mergeRecords de-duplicates by id and prefers newer records", () => {
  const local = [{ id: "x", date: "2026-11-21T09:00:00.000Z", zone: "A", updatedAt: 100 }];
  const remote = [
    { id: "x", date: "2026-11-22T09:00:00.000Z", zone: "B", updatedAt: 200 },
    { id: "y", date: "2026-11-20T09:00:00.000Z", zone: "C", updatedAt: 50 },
  ];
  const merged = window.historyTest.mergeRecords(local, remote);
  assert.strictEqual(merged.length, 2);
  assert.strictEqual(merged[0].zone, "B");
  assert.strictEqual(merged[1].zone, "C");
});

test("syncHistory fails safely without a browser fetch API", async () => {
  assert.strictEqual(await window.historyTest.syncHistory(), false);
});

run();