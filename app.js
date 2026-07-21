const sheets = {
  daily: "Daily_Capacity",
  requests: "Inspection_Requests",
  response: "Inspector_Response",
  config: "Dashboard_Config",
};

const sheetGids = {
  Daily_Capacity: "1002",
  Inspection_Requests: "1001",
  Inspector_Response: "1003",
  Dashboard_Config: "1004",
};

const spreadsheetId = "1ZaIHyL6iMFXmlYQoZHfQNdVRFU6Jy83dYgYqyASt3Q4";
const fallbackMonthlySummary = [
  { month: "2026-05", requests: 38, days: 21, avg: 1.81, max: 3, through: "2026-05-31" },
  { month: "2026-06", requests: 62, days: 22, avg: 2.82, max: 6, through: "2026-06-30" },
  { month: "2026-07", requests: 60, days: 17, avg: 3.53, max: 6, through: "2026-07-20" },
];

const requestHeaders = [
  "request_id",
  "date",
  "work_item",
  "location",
  "request_type",
  "ready_time",
  "accepted_time",
  "inspection_time",
  "inspector",
  "waiting_minutes",
  "delay_category",
  "status",
  "confidence",
  "source_refs",
  "excerpt",
  "review_note",
  "valid_for_demand",
  "manual_review_status",
  "sync_note",
];

const state = {
  daily: [],
  requests: [],
  response: [],
  config: {},
};

const $ = (id) => document.getElementById(id);

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quoted) {
      if (char === '"' && next === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(value);
      value = "";
    } else if (char === "\n") {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else if (char !== "\r") {
      value += char;
    }
  }

  if (value.length || row.length) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}

function toObjects(rows) {
  const headers = rows[0] || [];
  return rows.slice(1).filter((row) => row.some(Boolean)).map((row) => {
    const item = {};
    headers.forEach((header, index) => {
      if (header) item[header] = row[index] || "";
    });
    return item;
  });
}

function rowsToObjectsWithHeaders(rows, headers) {
  return rows.filter((row) => row.some(Boolean)).map((row) => {
    const item = {};
    headers.forEach((header, index) => {
      item[header] = row[index] || "";
    });
    return item;
  });
}

function normalizeSheetRows(sheet, rows) {
  if (sheet === sheets.requests && rows[0]?.[0]?.startsWith("request_id ")) {
    return rowsToObjectsWithHeaders(rows.slice(1), requestHeaders);
  }
  return toObjects(rows);
}

function asNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function inferDate(row) {
  if (row.date) return row.date;
  const source = row.source_file || row.source_refs || "";
  const match = source.match(/(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : "";
}

function formatDate(value) {
  if (!value) return "-";
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.valueOf())) return value;
  return parsed.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatMonth(value) {
  const parsed = new Date(`${value}-01T00:00:00`);
  if (Number.isNaN(parsed.valueOf())) return value;
  return parsed.toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
  });
}

function configValue(key, fallback = "-") {
  return state.config[key]?.value || fallback;
}

function parseMonthlyNote(note = "") {
  return Object.fromEntries(
    note
      .split(";")
      .map((part) => part.split("="))
      .filter(([key, value]) => key && value)
      .map(([key, value]) => [key.trim(), value.trim()]),
  );
}

function monthlyRowsFromConfig() {
  const rows = Object.values(state.config)
    .filter((row) => row.key?.startsWith("monthly_"))
    .map((row) => {
      const note = parseMonthlyNote(row.note);
      return {
        month: row.key.replace("monthly_", ""),
        requests: asNumber(row.value),
        days: asNumber(note.days),
        avg: Number(note.avg || 0),
        max: asNumber(note.max),
        through: note.through || "",
      };
    })
    .filter((row) => row.month && row.requests > 0)
    .sort((a, b) => a.month.localeCompare(b.month));
  return rows.length ? rows : fallbackMonthlySummary;
}

function googleCsvUrl(sheet, mode = "sheet") {
  const url = new URL(
    `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq`,
  );
  url.searchParams.set("tqx", "out:csv");
  if (mode === "gid") {
    url.searchParams.set("gid", sheetGids[sheet]);
  } else {
    url.searchParams.set("sheet", sheet);
  }
  url.searchParams.set("_", Date.now().toString());
  return url;
}

async function fetchCsvWithFallback(sheet) {
  const first = await fetch(googleCsvUrl(sheet), { cache: "no-store" });
  if (first.ok) return first;
  if (sheetGids[sheet]) {
    const second = await fetch(googleCsvUrl(sheet, "gid"), { cache: "no-store" });
    if (second.ok) return second;
    return second;
  }
  return first;
}

async function fetchSheet(sheet) {
  const shouldUseProxy =
    window.location.protocol !== "file:" && window.location.port === "4173";
  let response;
  if (shouldUseProxy) {
    const proxyPath = `/api/sheet?sheet=${encodeURIComponent(sheet)}`;
    response = await fetch(proxyPath, { cache: "no-store" });
    if (response.status === 404 || response.status === 405) {
      response = await fetchCsvWithFallback(sheet);
    }
  } else {
    response = await fetchCsvWithFallback(sheet);
  }
  if (!response.ok) {
    throw new Error(`Cannot load ${sheet}: ${response.status}`);
  }
  return normalizeSheetRows(sheet, parseCsv(await response.text()));
}

async function loadData() {
  $("summaryLine").textContent = "กำลังโหลดข้อมูลจาก Google Sheet...";
  const [daily, requests, response, configRows] = await Promise.all([
    fetchSheet(sheets.daily),
    fetchSheet(sheets.requests),
    fetchSheet(sheets.response),
    fetchSheet(sheets.config),
  ]);

  state.daily = daily
    .map((row) => ({ ...row, date: inferDate(row) }))
    .filter((row) => row.date)
    .map((row) => ({
      ...row,
      message_count: asNumber(row.message_count),
      request_count: asNumber(row.request_count),
      completed: asNumber(row.completed),
      unconfirmed: asNumber(row.unconfirmed),
      cancelled: asNumber(row.cancelled),
      gcr_capacity: asNumber(row.gcr_capacity),
      excess_over_2: asNumber(row.excess_over_2),
      manual_review_count: asNumber(row.manual_review_count),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  state.requests = requests
    .map((row) => ({ ...row, date: inferDate(row) }))
    .filter((row) => row.request_id && row.date);
  state.response = response
    .map((row) => ({ ...row, date: inferDate(row) }))
    .filter((row) => row.date);
  state.config = Object.fromEntries(configRows.filter((row) => row.key).map((row) => [row.key, row]));
  render();
}

function latestDaily() {
  return state.daily[state.daily.length - 1] || {};
}

function renderKpis(latest) {
  $("targetDate").textContent = formatDate(configValue("target_date", latest.date));
  $("viberGroup").textContent = configValue("viber_group", "GCR-ITD Survey");
  $("lastUpdated").textContent = latest.last_updated || configValue("target_date", "-");
  $("requestCount").textContent = latest.request_count ?? "-";
  $("messageCount").textContent = latest.message_count ?? "-";
  $("completedCount").textContent = latest.completed ?? "-";
  $("unconfirmedCount").textContent = latest.unconfirmed ?? "-";
  $("cancelledCount").textContent = latest.cancelled ?? "-";
  $("excessCount").textContent = latest.excess_over_2 ?? "-";
  $("requestContext").textContent = `${formatDate(latest.date)} target day`;

  const pressure =
    latest.excess_over_2 > 0
      ? `Demand exceeds Capacity by ${latest.excess_over_2} request(s).`
      : "Daily demand is within current 2-GCR capacity.";
  $("summaryLine").textContent = `${pressure} ${configValue("report_summary", "")}`;
}

function renderTrend() {
  const chart = $("trendChart");
  const rows = state.daily.slice(-24);
  if (!rows.length) {
    chart.innerHTML = '<div class="empty">No daily rows found.</div>';
    return;
  }
  const maxValue = Math.max(1, ...rows.map((row) => row.request_count));
  chart.innerHTML = rows
    .map((row) => {
      const height = Math.max(4, Math.round((row.request_count / maxValue) * 190));
      const capacityTop = Math.max(0, 190 - Math.round((row.gcr_capacity / maxValue) * 190));
      return `
        <div class="bar-wrap" title="${row.date}: ${row.request_count} request(s)">
          <div class="bar ${row.request_count > row.gcr_capacity ? "over" : ""}" style="height:${height}px">
            <span class="capacity-line" style="top:${capacityTop}px"></span>
          </div>
          <span class="bar-label">${row.date.slice(5)}</span>
        </div>
      `;
    })
    .join("");
}

function renderMonthlySummary() {
  const container = $("monthlySummary");
  const rows = monthlyRowsFromConfig();
  const maxRequests = Math.max(1, ...rows.map((row) => row.requests));
  container.innerHTML = rows
    .map((row) => {
      const width = Math.max(8, Math.round((row.requests / maxRequests) * 100));
      return `
        <article class="month-card">
          <header>
            <div>
              <strong>${formatMonth(row.month)}</strong>
              <span>through ${formatDate(row.through)}</span>
            </div>
            <b>${row.requests}</b>
          </header>
          <div class="month-bar-track">
            <div class="month-bar" style="width:${width}%"></div>
          </div>
          <dl>
            <div><dt>Days</dt><dd>${row.days}</dd></div>
            <div><dt>Avg/day</dt><dd>${row.avg.toFixed(2)}</dd></div>
            <div><dt>Max/day</dt><dd>${row.max}</dd></div>
          </dl>
        </article>
      `;
    })
    .join("");
}

function renderInspectors(latest) {
  const container = $("inspectorList");
  const rows = state.response.filter((row) => row.date === latest.date);
  if (!rows.length) {
    container.innerHTML = '<div class="empty">No inspector rows for latest date.</div>';
    return;
  }
  container.innerHTML = rows
    .map((row) => `
      <div class="inspector-card">
        <header>
          <strong>${row.inspector || "Unassigned"}</strong>
          <span class="tag">${row.accepted_count || 0} accepted</span>
        </header>
        <p class="small muted">Completed ${row.completed_count || 0} · Unconfirmed ${row.unconfirmed_assigned_count || 0} · Cancel ack ${row.cancelled_ack_count || 0}</p>
        <p class="small">${row.notes || ""}</p>
      </div>
    `)
    .join("");
}

function renderReviewQueue(latest) {
  const container = $("reviewQueue");
  const rows = state.requests
    .filter((row) => row.date === latest.date)
    .filter((row) => row.status !== "completed" || row.confidence === "manual_review");
  if (!rows.length) {
    container.innerHTML = '<div class="empty">No manual review items for latest date.</div>';
    return;
  }
  container.innerHTML = rows
    .map((row) => `
      <div class="review-card">
        <header>
          <strong>${row.inspector || "Unassigned"}</strong>
          <span class="tag ${row.status === "cancelled" ? "danger" : "warn"}">${row.status}</span>
        </header>
        <p class="excerpt">${row.work_item}</p>
        <p class="small muted">Ready ${row.ready_time || "-"} · Accepted ${row.accepted_time || "-"}</p>
        <p class="small muted">${row.source_refs || ""}</p>
      </div>
    `)
    .join("");
}

function renderRequests(latest) {
  const container = $("requestTable");
  const rows = state.requests.filter((row) => row.date === latest.date);
  if (!rows.length) {
    container.innerHTML = '<div class="empty">No requests for latest date.</div>';
    return;
  }
  container.innerHTML = rows
    .map((row) => `
      <div class="request-row">
        <header>
          <strong>${row.request_id}</strong>
          <span class="tag">${row.request_type || "request"}</span>
        </header>
        <p class="excerpt">${row.excerpt || row.work_item}</p>
        <p class="small muted">${row.source_refs || ""}</p>
      </div>
    `)
    .join("");
}

function render() {
  const latest = latestDaily();
  renderKpis(latest);
  renderMonthlySummary();
  renderTrend();
  renderInspectors(latest);
  renderReviewQueue(latest);
  renderRequests(latest);
}

$("refreshButton").addEventListener("click", () => {
  loadData().catch((error) => {
    $("summaryLine").textContent = `โหลดข้อมูลไม่สำเร็จ: ${error.message}. ถ้าเปิดจาก static preview ให้รัน node web-dashboard/server.mjs แล้วเปิด http://localhost:4173`;
  });
});

loadData().catch((error) => {
  $("summaryLine").textContent = `โหลดข้อมูลไม่สำเร็จ: ${error.message}. ถ้าเปิดจาก static preview ให้รัน node web-dashboard/server.mjs แล้วเปิด http://localhost:4173`;
});
