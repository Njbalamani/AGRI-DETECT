/* AGRI DETECT — History (local detection records).
   Persistence schema (single localStorage key, see schema docs in README):
     agri_history: JSON array of scan records, newest first, capped at 50.
   A record is the object produced by detection.js's saveToHistory():
     { id, crop, cropId, risk, date, thumb, note, confidence, method,
       findings, [followUpAt], [followUpDone] }.
   Three demo rows are seeded on first ever load so a fresh install is not empty.
   The delete buttons and the per-record detail are 100% local — nothing here
   touches the network. */
const STORAGE_KEY = "agri_history";
const QUEUE_KEY = "agri_sync_queue";
const SYNC_URL = "/api/history/sync";

const SEED = [
  {
    id: 1,
    crop: "Date Palm — Palm 12",
    risk: "medium",
    date: "2 Sep 2026, 08:40",
    note: "Demo entry — holes at crown base, recheck in 48h. Real entries are added by the Detection screen.",
  },
  {
    id: 2,
    crop: "Date Palm — Palm 31",
    risk: "low",
    date: "1 Sep 2026, 17:05",
    note: "Demo entry — routine weekly check, no damage signs.",
  },
  {
    id: 3,
    crop: "Date Palm — Palm 07",
    risk: "high",
    date: "1 Sep 2026, 09:15",
    note: "Demo entry — damaged shoot matched weevil activity pattern, logged for follow-up.",
  },
];

function parseHistory(raw) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((r) => r && typeof r === "object") : [];
  } catch (e) {
    return [];
  }
}

function loadHistory() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw !== null) return parseHistory(raw);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(SEED));
  return [...SEED];
}

function saveHistory(history) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    return true;
  } catch (e) {
    return false;
  }
}

function mergeRecords(local, remote) {
  const byId = new Map();
  const stamp = (rec) => Number(rec.updatedAt) || Number(rec.followUpAt) || 0;
  [].concat(Array.isArray(local) ? local : [], Array.isArray(remote) ? remote : [])
    .forEach((rec) => {
      if (!rec || rec.id === undefined || rec.id === null) return;
      const key = String(rec.id);
      const prev = byId.get(key);
      if (!prev || stamp(rec) >= stamp(prev)) byId.set(key, rec);
    });
  return Array.from(byId.values()).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
}

async function syncHistory() {
  if (typeof window.fetch !== "function") return false;
  if (!/^https?:$/.test(window.location.protocol || "")) return false;
  try {
    const local = loadHistory();
    const res = await window.fetch(SYNC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ records: local }),
    });
    if (!res || !res.ok) return false;
    const data = await res.json();
    const merged = mergeRecords(local, data && data.records);
    saveHistory(merged);
    renderHistory();
    return true;
  } catch (e) {
    return false;
  }
}

function historyMethodLabel(method) {
  if (method === "vision") return t("method_vision");
  if (method === "model") return t("method_model");
  if (method === "local") return t("method_local");
  return "";
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

function historyCsv(history) {
  const columns = [
    ["Date", "date"],
    ["Crop", "crop"],
    ["Crop ID", "cropId"],
    ["Palm ID", "palmId"],
    ["Zone", "zone"],
    ["Risk", "risk"],
    ["Confidence", "confidence"],
    ["Method", "method"],
    ["Findings", "findings"],
    ["Guidance", "guidance"],
    ["Note", "note"],
    ["Recheck due", "followUpAt"],
    ["Recheck done", "followUpDone"],
  ];
  const rows = history.map((rec) => columns.map(([, key]) => csvCell(rec[key])).join(","));
  return [columns.map(([label]) => csvCell(label)).join(",")].concat(rows).join("\r\n");
}

function historyRecordDate(rec) {
  const raw = rec && (rec.sourceUpdatedAt || rec.date || rec.timestamp || rec.createdAt);
  if (!raw) return null;
  const text = String(raw).trim();
  const dayOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (dayOnly) return new Date(Number(dayOnly[1]), Number(dayOnly[2]) - 1, Number(dayOnly[3]));
  const parsed = new Date(text.replace(/,/g, " "));
  return isNaN(parsed.getTime()) ? null : parsed;
}

function currentHistoryFilters() {
  const search = document.getElementById("history-search");
  const risk = document.getElementById("history-risk");
  const method = document.getElementById("history-method");
  const zone = document.getElementById("history-zone");
  const from = document.getElementById("history-from");
  const to = document.getElementById("history-to");
  const due = document.getElementById("history-due");
  return {
    search: (search && search.value ? search.value : "").trim().toLowerCase(),
    risk: (risk && risk.value ? risk.value : "all"),
    method: (method && method.value ? method.value : "all"),
    zone: (zone && zone.value ? zone.value : "").trim().toLowerCase(),
    from: from && from.value ? from.value : "",
    to: to && to.value ? to.value : "",
    due: !!(due && due.checked),
  };
}

function filterHistory(history, filters) {
  const f = filters || {};
  const term = (f.search || "").trim().toLowerCase();
  const risk = f.risk || "all";
  const method = f.method || "all";
  const zone = (f.zone || "").trim().toLowerCase();
  return (Array.isArray(history) ? history : []).filter((rec) => {
    if (risk !== "all" && riskClass(rec.risk) !== risk) return false;
    if (method !== "all" && (rec.method || "") !== method) return false;
    if (zone && String(rec.zone || "").toLowerCase().indexOf(zone) === -1) return false;
    if (f.from || f.to) {
      const date = historyRecordDate(rec);
      if (f.from && (!date || date < new Date(f.from + "T00:00:00"))) return false;
      if (f.to && (!date || date > new Date(f.to + "T23:59:59.999"))) return false;
    }
    if (f.due && !(rec.followUpAt && !rec.followUpDone)) return false;
    if (!term) return true;
    const haystack = [
      rec.crop, rec.cropId, rec.palmId, rec.zone, rec.risk, rec.findings,
      rec.guidance, rec.note, rec.method, historyMethodLabel(rec.method),
    ].map((v) => (v === null || v === undefined ? "" : String(v))).join(" ").toLowerCase();
    return haystack.indexOf(term) !== -1;
  });
}

function historyAnalytics(history) {
  const risk = {};
  const crop = {};
  const zone = {};
  const add = (map, key) => { if (key) map[key] = (map[key] || 0) + 1; };
  (Array.isArray(history) ? history : []).forEach((rec) => {
    const riskName = typeof riskLabel === "function" ? riskLabel(rec.risk) : String(rec.risk || "");
    add(risk, String(riskName || ""));
    const cropName = String(rec.crop || "").replace(/ — .*$/, "").trim();
    add(crop, cropName);
    add(zone, String(rec.zone || "").trim());
  });
  return { risk: risk, crop: crop, zone: zone, total: (Array.isArray(history) ? history.length : 0) };
}

function historyBars(counts, limit) {
  const entries = Object.keys(counts || {})
    .map((key) => [key, Number(counts[key]) || 0])
    .filter((entry) => entry[0] && entry[1] > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit || 6);
  if (!entries.length) return '<div class="chart-empty">—</div>';
  const max = entries.reduce((m, entry) => Math.max(m, entry[1]), 0) || 1;
  return entries.map((entry) => {
    const pct = Math.max(4, Math.round((entry[1] / max) * 100));
    return '<div class="bar-row"><span class="bar-label">' + esc(entry[0]) + '</span>' +
      '<span class="bar-track"><span class="bar-fill" style="width:' + pct + '%"></span></span>' +
      '<span class="bar-count">' + entry[1] + "</span></div>";
  }).join("");
}

function renderHistoryAnalytics(history) {
  const data = historyAnalytics(history);
  const targets = [
    ["risk-chart", data.risk, 5],
    ["crop-chart", data.crop, 6],
    ["zone-chart", data.zone, 6],
  ];
  targets.forEach(([id, counts, limit]) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = historyBars(counts, limit);
  });
}

function downloadHistoryCsv() {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return false;
  const csv = historyCsv(filterHistory(loadHistory(), currentHistoryFilters()));
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "agri-inspection-history.csv";
  if (a.click) a.click();
  setTimeout(() => {
    if (typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(a.href);
  }, 4000);
  return true;
}

function historyMetaHtml(rec) {
  const conf = rec.confidence ? esc(String(rec.confidence)) + "%" : "";
  const meth = historyMethodLabel(rec.method);
  const field = [
    rec.palmId ? "Palm " + esc(rec.palmId) : "",
    rec.zone ? esc(rec.zone) : "",
  ].filter(Boolean).join(" · ");
  const parts = [field, meth, conf].filter(Boolean);
  return parts.length ? '<span class="history-meta">' + parts.join(" · ") + "</span>" : "";
}

function followUpHtml(rec) {
  if (!rec.followUpAt || rec.followUpDone) return "";
  const overdue = Date.now() >= rec.followUpAt;
  return '<span class="history-meta" style="margin-left:8px;color:' +
    (overdue ? "var(--red)" : "var(--mid)") + '">' +
    t(overdue ? "recheck_due" : "recheck_pending") + "</span>";
}

function historyItemHtml(rec) {
  const crop = esc(rec.crop);
  const thumb = rec.thumb
    ? '<img class="history-thumb" src="' + esc(rec.thumb) + '" alt="Palm photo">'
    : '<div class="history-thumb">🌴</div>';
  const note = rec.note ? '<p class="history-note">' + esc(rec.note) + "</p>" : "";
  const guidance = rec.guidance ? '<p class="history-note">' + esc(rec.guidance) + "</p>" : "";
  return `
    <div class="history-item" data-id="${esc(rec.id)}">
      ${thumb}
      <div class="history-info">
        <div class="row">
          <span class="crop">${crop}</span>
          <span class="risk-badge ${riskClass(rec.risk)}">${riskLabel(rec.risk)}</span>
        </div>
        <div class="row" style="margin-top:4px">
          <span class="date">${esc(rec.date)}</span>
          <button class="del" data-del="${esc(rec.id)}" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:.8rem">${t("delete")}</button>
        </div>
        ${historyMetaHtml(rec)}${followUpHtml(rec)}
        ${note}${guidance}
      </div>
    </div>`;
}

function markFollowUpDone(id) {
  const history = loadHistory();
  let changed = false;
  history.forEach((rec) => {
    if (String(rec.id) === String(id) && rec.followUpAt && !rec.followUpDone) {
      rec.followUpDone = true;
      changed = true;
    }
  });
  if (changed) saveHistory(history);
  renderHistory();
  return changed;
}

function openHistoryDetail(rec) {
  const crop = esc(rec.crop);
  const thumb = rec.thumb
    ? '<img class="hm-thumb" src="' + esc(rec.thumb) + '" alt="Palm photo">'
    : '<div class="hm-thumb">🌴</div>';
  const findings = (Array.isArray(rec.findings) ? rec.findings : String(rec.findings || "").split(","))
    .map((f) => (f || "").trim())
    .filter(Boolean)
    .map((f) => t("f_" + f) || esc(f))
    .join(" · ");
  const meta = [
    esc(rec.date),
    rec.palmId ? "Palm " + esc(rec.palmId) : "",
    rec.zone ? esc(rec.zone) : "",
    historyMethodLabel(rec.method),
    rec.confidence ? esc(String(rec.confidence)) + "%" : "",
    rec.followUpAt && !rec.followUpDone ? t(Date.now() >= rec.followUpAt ? "recheck_due" : "recheck_pending") : "",
  ].filter(Boolean).join(" · ");
  const doneButton = rec.followUpAt && !rec.followUpDone
    ? '<button class="btn" style="flex:1" id="hm-done">' + t("mark_recheck_done") + "</button>"
    : "";
  const closeButton = '<button class="btn" style="flex:1" id="hm-close">' + t("close") + "</button>";
  const overlay = document.createElement("div");
  overlay.className = "history-overlay";
  overlay.innerHTML = `
    <div class="history-modal">
      ${thumb}
      <div class="row">
        <span class="hm-crop">${crop}</span>
        <span class="risk-badge ${riskClass(rec.risk)}">${riskLabel(rec.risk)}</span>
      </div>
      <div class="hm-meta">${meta}</div>
      ${findings ? '<p class="hm-note">' + findings + "</p>" : ""}
      ${rec.note ? '<p class="hm-note">' + esc(rec.note) + "</p>" : ""}
      ${rec.guidance ? '<p class="hm-note">' + esc(rec.guidance) + "</p>" : ""}
      <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">
        <a class="btn" style="flex:1;text-align:center" href="detection.html?crop=${encodeURIComponent(rec.cropId || "date-palm")}&name=${encodeURIComponent(String(rec.crop || "").replace(/ — .*$/, ""))}&palm=${encodeURIComponent(rec.palmId || "")}&zone=${encodeURIComponent(rec.zone || "")}">${t("rescan")}</a>
        ${doneButton}
        ${closeButton}
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay || e.target.id === "hm-close") overlay.remove();
  });
  const doneBtn = overlay.querySelector("#hm-done");
  if (doneBtn) doneBtn.addEventListener("click", () => {
    markFollowUpDone(rec.id);
    overlay.remove();
  });
}

function renderHistory() {
  const all = loadHistory();
  const history = filterHistory(all, currentHistoryFilters());
  renderHistoryAnalytics(history);
  const list = document.getElementById("history-list");
  const count = document.getElementById("count");

  if (!history.length) {
    list.innerHTML = all.length
      ? '<div class="empty-state">' + t("no_matching") + "</div>"
      : '<div class="empty-state">' + t("no_history") + '<br><br><a class="btn" href="detection.html">' + t("run_detection") + "</a></div>";
    count.textContent = history.length + " " + t("records");
    return;
  }

  list.innerHTML = history.map(historyItemHtml).join("");
  count.textContent = history.length + (history.length !== all.length ? " / " + all.length : "") +
    " " + (history.length > 1 ? t("records") : t("record"));

  list.querySelectorAll("[data-del]").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      saveHistory(loadHistory().filter((r) => String(r.id) !== String(btn.dataset.del)));
      renderHistory();
    });
  });

  list.querySelectorAll(".history-item").forEach((item) => {
    item.addEventListener("click", () => {
      const rec = loadHistory().find((r) => String(r.id) === String(item.dataset.id));
      if (rec) openHistoryDetail(rec);
    });
  });
}

function wireHistoryControls() {
  ["history-search", "history-risk", "history-method", "history-zone", "history-from", "history-to", "history-due"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const event = el.type === "checkbox" || el.tagName === "SELECT" ? "change" : "input";
    el.addEventListener(event, renderHistory);
  });
  const exportBtn = document.getElementById("export-history");
  if (exportBtn) exportBtn.addEventListener("click", downloadHistoryCsv);
  const syncBtn = document.getElementById("sync-history");
  if (syncBtn) syncBtn.addEventListener("click", async () => {
    const ok = await syncHistory();
    syncBtn.textContent = ok ? t("saved") : t("save_failed");
    setTimeout(() => { syncBtn.textContent = t("sync_history"); }, 1800);
  });
}

wireHistoryControls();

document.getElementById("clear-all").addEventListener("click", () => {
  if (confirm(t("confirm_delete"))) {
    saveHistory([]);
    renderHistory();
  }
});

window.onLangChange = function () {
  renderHistory();
};

/* Test hook for tests/run-tests.js — lets the runner exercise the real
   load/save round-trip and the demo-seed path without touching the DOM. */
window.historyTest = {
  STORAGE_KEY: STORAGE_KEY,
  loadHistory: loadHistory,
  saveHistory: saveHistory,
  parseHistory: parseHistory,
  historyCsv: historyCsv,
  filterHistory: filterHistory,
  historyRecordDate: historyRecordDate,
  historyAnalytics: historyAnalytics,
  historyBars: historyBars,
  historyMethodLabel: historyMethodLabel,
  markFollowUpDone: markFollowUpDone,
  mergeRecords: mergeRecords,
  syncHistory: syncHistory,
};

renderHistory();
