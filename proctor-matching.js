console.log("Proctor Matching loaded.");

const netlifyUpload = document.getElementById("netlify-upload");
const cohortUpload = document.getElementById("cohort-upload");
const statusPanel = document.getElementById("proctor-status");
const summaryPanel = document.getElementById("proctor-summary");
const validationPanel = document.getElementById("validation-panel");
const tableContainer = document.getElementById("proctor-table");
const downloadButton = document.getElementById("download-cleaned");
const runMatchingButton = document.getElementById("run-matching");
const matchingSummary = document.getElementById("matching-summary");
const matchingTrace = document.getElementById("matching-trace");
const matchingSolutions = document.getElementById("matching-solutions");

const summarySubmissions = document.getElementById("summary-submissions");
const summaryValid = document.getElementById("summary-valid");
const summaryCohorts = document.getElementById("summary-cohorts");
const summaryPreferences = document.getElementById("summary-preferences");

const ALLOWED_RESPONSES = new Set([
  "Preferred",
  "Available",
  "Unavailable",
  "GA/TA for this class"
]);

const state = {
  netlifyRows: null,
  cohortRows: null,
  cleanedRows: [],
  blockingIssues: [],
  warnings: [],
  staleSubmissionCount: 0,
  duplicateSubmissionCount: 0,
  reconciledMissingCount: 0,
  reconciledRemovedCount: 0,
  validSubmissionCount: 0,
  matchingSolutions: [],
  matchingStats: null
};

netlifyUpload.addEventListener("change", loadInputs);
cohortUpload.addEventListener("change", loadInputs);
downloadButton.addEventListener("click", downloadCleanedCsv);
runMatchingButton.addEventListener("click", runMatching);

async function loadInputs() {
  resetOutput();

  const netlifyFile = netlifyUpload.files?.[0];
  const cohortFile = cohortUpload.files?.[0];

  if (!netlifyFile || !cohortFile) {
    statusPanel.textContent = "Waiting for both files.";
    return;
  }

  try {
    const [netlifyText, cohortText] = await Promise.all([
      netlifyFile.text(),
      cohortFile.text()
    ]);

    state.netlifyRows = parseCsv(netlifyText);
    state.cohortRows = parseCsv(cohortText);

    processData();
  } catch (error) {
    state.blockingIssues = [error.message || "Unable to read the uploaded files."];
    renderValidation();
    statusPanel.textContent = "Files could not be processed.";
    statusPanel.classList.add("status-error");
  }
}

function processData() {
  state.cleanedRows = [];
  state.blockingIssues = [];
  state.warnings = [];
  state.staleSubmissionCount = 0;
  state.duplicateSubmissionCount = 0;
  state.reconciledMissingCount = 0;
  state.reconciledRemovedCount = 0;
  state.validSubmissionCount = 0;

  if (!state.netlifyRows.length) {
    state.blockingIssues.push("The Netlify export contains no submission rows.");
  }

  if (!state.cohortRows.length) {
    state.blockingIssues.push("The testing-cohort CSV contains no cohort rows.");
  }

  if (state.blockingIssues.length) {
    renderAll();
    return;
  }

  const netlifyHeaders = Object.keys(state.netlifyRows[0] || {});
  const payloadCol = findHeader(netlifyHeaders, [
    "preference_payload",
    "Preference Payload",
    "preference payload"
  ]);

  if (!payloadCol) {
    state.blockingIssues.push("Could not find the Netlify preference_payload column.");
    renderAll();
    return;
  }

  const nameCol = findHeader(netlifyHeaders, ["name", "Name", "Full name", "Full Name"]);
  const emailCol = findHeader(netlifyHeaders, ["email", "Email", "University email", "University Email"]);
  const periodCol = findHeader(netlifyHeaders, ["exam_period", "Exam Period", "exam period"]);
  const submittedCol = findHeader(netlifyHeaders, [
    "created_at", "Created At", "created at",
    "submitted_at", "Submitted At", "submitted at",
    "submission_created_at", "Submission Created At"
  ]);

  const parsedSubmissions = [];

  state.netlifyRows.forEach((submission, submissionIndex) => {
    const humanRow = submissionIndex + 1;
    const name = nameCol ? String(submission[nameCol] ?? "").trim() : "";
    const email = emailCol ? String(submission[emailCol] ?? "").trim() : "";
    const examPeriod = periodCol ? String(submission[periodCol] ?? "").trim() : "";
    const submittedAt = submittedCol ? String(submission[submittedCol] ?? "").trim() : "";

    if (!name) {
      state.blockingIssues.push(`Submission row ${humanRow}: missing proctor name.`);
      return;
    }

    if (!email) {
      state.blockingIssues.push(`Submission row ${humanRow}: missing proctor email.`);
      return;
    }

    let payload;
    try {
      payload = JSON.parse(submission[payloadCol]);
    } catch {
      state.blockingIssues.push(`Submission row ${humanRow}: preference_payload is not valid JSON.`);
      return;
    }

    if (!Array.isArray(payload)) {
      state.blockingIssues.push(`Submission row ${humanRow}: preference_payload is not an array.`);
      return;
    }

    // Validate the submitted form as submitted, independently of the uploaded cohort CSV.
    // The user-selected cohort CSV is authoritative for output, not for historical validity.
    let preferredCount = 0;
    let hasBlockingProblem = false;
    const submittedKeys = new Set();

    payload.forEach((entry, payloadIndex) => {
      const response = String(entry?.response ?? "").trim();
      const embeddedCohort = entry?.cohort;

      if (!ALLOWED_RESPONSES.has(response)) {
        state.blockingIssues.push(
          `Submission row ${humanRow}, submitted cohort ${payloadIndex + 1}: unknown response "${response}".`
        );
        hasBlockingProblem = true;
      }
      if (response === "Preferred") preferredCount += 1;

      if (!embeddedCohort || typeof embeddedCohort !== "object" || Array.isArray(embeddedCohort) || !Object.keys(embeddedCohort).length) {
        state.blockingIssues.push(`Submission row ${humanRow}, submitted cohort ${payloadIndex + 1}: missing embedded cohort.`);
        hasBlockingProblem = true;
        return;
      }
      const key = cohortIdentity(embeddedCohort);
      if (submittedKeys.has(key)) {
        state.blockingIssues.push(`Submission row ${humanRow}: duplicate cohort identity in submitted preferences; cannot reconcile safely.`);
        hasBlockingProblem = true;
      }
      submittedKeys.add(key);
    });

    if (preferredCount !== 3) {
      state.blockingIssues.push(
        `Submission row ${humanRow}: expected exactly 3 Preferred responses but found ${preferredCount}.`
      );
      hasBlockingProblem = true;
    }

    if (hasBlockingProblem) return;

    parsedSubmissions.push({
      humanRow,
      name,
      email,
      emailKey: email.toLowerCase(),
      examPeriod,
      submittedAt,
      submittedMs: parseTimestamp(submittedAt),
      payload
    });
  });

  // Resolve duplicates deterministically:
  // - earliest valid submission time determines FCFS priority
  // - latest valid submission payload determines operative preferences
  const byEmail = new Map();

  for (const submission of parsedSubmissions) {
    if (!byEmail.has(submission.emailKey)) {
      byEmail.set(submission.emailKey, []);
    }
    byEmail.get(submission.emailKey).push(submission);
  }

  const resolvedSubmissions = [];

  for (const [emailKey, submissions] of byEmail.entries()) {
    submissions.sort(compareSubmissionTimes);

    const earliest = submissions[0];
    const latest = submissions[submissions.length - 1];

    if (submissions.length > 1) {
      state.duplicateSubmissionCount += submissions.length - 1;
      state.warnings.push(
        `Duplicate submission resolved for "${emailKey}": ` +
        `latest valid preferences from Netlify row ${latest.humanRow} are used, ` +
        `while FCFS priority is preserved from earliest valid row ${earliest.humanRow}.`
      );
    }

    resolvedSubmissions.push({
      ...latest,
      prioritySubmittedAt: earliest.submittedAt,
      prioritySubmittedMs: earliest.submittedMs
    });
  }

  // Do not silently guess when the uploaded cohort CSV itself has duplicate identities.
  const uploadedKeys = new Map();
  state.cohortRows.forEach((cohort, index) => {
    const key = cohortIdentity(cohort);
    if (uploadedKeys.has(key)) {
      state.blockingIssues.push(
        `Uploaded cohort CSV rows ${uploadedKeys.get(key) + 1} and ${index + 1} have identical cohort attributes; reconciliation is ambiguous.`
      );
    } else {
      uploadedKeys.set(key, index);
    }
  });
  if (state.blockingIssues.length) {
    renderAll();
    return;
  }

  state.validSubmissionCount = resolvedSubmissions.length;

  resolvedSubmissions.forEach((submission) => {
    const responseByIdentity = new Map(
      submission.payload.map(entry => [cohortIdentity(entry.cohort), String(entry.response).trim()])
    );
    let missing = 0;
    let retained = 0;
    state.cohortRows.forEach((authoritative, currentIndex) => {
      const key = cohortIdentity(authoritative);
      const exists = responseByIdentity.has(key);
      if (exists) retained += 1;
      else missing += 1;

      state.cleanedRows.push({
        "Proctor Name": submission.name,
        "Email": submission.email,
        "Submission Time": submission.prioritySubmittedAt,
        "Submission Order": "",
        "Latest Submission Time": submission.submittedAt,
        "Exam Period": submission.examPeriod,
        "Cohort Index": currentIndex + 1,
        ...authoritative,
        "Response": exists ? responseByIdentity.get(key) : "Unavailable"
      });
    });

    const removed = submission.payload.length - retained;
    state.reconciledMissingCount += missing;
    state.reconciledRemovedCount += removed;
    if (missing || removed) {
      state.warnings.push(
        `Submission row ${submission.humanRow} (${submission.email}): retained ${retained} matching preferences; ` +
        `${missing} cohort${missing === 1 ? "" : "s"} absent from that submission defaulted to Unavailable; ` +
        `${removed} submitted cohort${removed === 1 ? "" : "s"} absent from the uploaded CSV omitted.`
      );
    }
  });

  assignSubmissionOrder();
  renderAll();
}

function compareSubmissionTimes(a, b) {
  const ta = a.submittedMs;
  const tb = b.submittedMs;

  if (ta !== null && tb !== null && ta !== tb) return ta - tb;
  if (ta !== null && tb === null) return -1;
  if (ta === null && tb !== null) return 1;
  return a.humanRow - b.humanRow;
}

function assignSubmissionOrder() {
  const groups = new Map();

  for (const row of state.cleanedRows) {
    const key = row["Email"].trim().toLowerCase();
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        email: row["Email"],
        name: row["Proctor Name"],
        submittedAt: row["Submission Time"]
      });
    }
  }

  const ordered = [...groups.values()].sort((a, b) => {
    const ta = parseTimestamp(a.submittedAt);
    const tb = parseTimestamp(b.submittedAt);

    if (ta !== null && tb !== null && ta !== tb) return ta - tb;
    if (ta !== null) return -1;
    if (tb !== null) return 1;
    return a.key.localeCompare(b.key);
  });

  const orderMap = new Map(ordered.map((item, index) => [item.key, index + 1]));

  for (const row of state.cleanedRows) {
    const key = row["Email"].trim().toLowerCase();
    row["Submission Order"] = orderMap.get(key) || "";
  }
}

function parseTimestamp(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const time = Date.parse(raw);
  return Number.isNaN(time) ? null : time;
}

function cohortIdentity(cohort) {
  return JSON.stringify(
    Object.entries(cohort)
      .map(([key, value]) => [normalize(key), normalizeCell(value)])
      .sort((a, b) => a[0].localeCompare(b[0]))
  );
}

function renderAll() {
  renderSummary();
  renderValidation();
  renderTable();

  const canExport = state.blockingIssues.length === 0 && state.cleanedRows.length > 0;
  downloadButton.disabled = !canExport;
  runMatchingButton.disabled = !canExport;

  if (state.blockingIssues.length) {
    statusPanel.textContent = "Validation failed. Fix the blocking issues before exporting cleaned data.";
    statusPanel.classList.add("status-error");
  } else {
    const note = state.warnings.length
      ? `Files parsed successfully with ${state.warnings.length} warning${state.warnings.length === 1 ? "" : "s"}.`
      : "Files parsed and validated successfully.";
    statusPanel.textContent = note;
    statusPanel.classList.remove("status-error");
  }
}

function renderSummary() {
  summaryPanel.hidden = false;
  summarySubmissions.textContent = state.netlifyRows?.length ?? 0;
  summaryValid.textContent = state.validSubmissionCount;
  summaryCohorts.textContent = state.cohortRows?.length ?? 0;
  summaryPreferences.textContent = state.cleanedRows.length;
}

function renderValidation() {
  validationPanel.hidden = false;

  if (!state.blockingIssues.length && !state.warnings.length) {
    validationPanel.innerHTML = `
      <div class="validation-success">
        <strong>Validation passed.</strong> No blocking issues detected.
      </div>
    `;
    return;
  }

  const blocks = state.blockingIssues.length
    ? `<div class="validation-block">
         <strong>Blocking issues (${state.blockingIssues.length})</strong>
         <ul>${state.blockingIssues.map(issue => `<li>${escapeHtml(issue)}</li>`).join("")}</ul>
       </div>`
    : "";

  const warnings = state.warnings.length
    ? `<div class="validation-warning">
         <strong>Warnings (${state.warnings.length})</strong>
         <ul>${state.warnings.map(issue => `<li>${escapeHtml(issue)}</li>`).join("")}</ul>
       </div>`
    : "";

  validationPanel.innerHTML = blocks + warnings;
}

function renderTable() {
  if (!state.cleanedRows.length) {
    tableContainer.innerHTML = `<div class="no-data">No cleaned preference rows available.</div>`;
    return;
  }

  const columns = Object.keys(state.cleanedRows[0]);
  const previewRows = state.cleanedRows.slice(0, 500);

  tableContainer.innerHTML = `
    <div class="proctor-table-note">
      Showing ${previewRows.length}${state.cleanedRows.length > 500 ? ` of ${state.cleanedRows.length}` : ""} cleaned rows.
    </div>
    <div class="proctor-table-scroll">
      <table>
        <thead>
          <tr>${columns.map(c => `<th>${escapeHtml(c)}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${previewRows.map(row => `
            <tr>${columns.map(c => `<td>${escapeHtml(row[c] ?? "")}</td>`).join("")}</tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function downloadCleanedCsv() {
  if (downloadButton.disabled || !state.cleanedRows.length) return;

  const columns = Object.keys(state.cleanedRows[0]);
  const lines = [
    columns.map(csvEscape).join(","),
    ...state.cleanedRows.map(row => columns.map(col => csvEscape(row[col] ?? "")).join(","))
  ];

  const blob = new Blob([lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "aes-proctor-preferences-cleaned.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function resetOutput() {
  state.cleanedRows = [];
  state.blockingIssues = [];
  state.warnings = [];
  state.staleSubmissionCount = 0;
  state.duplicateSubmissionCount = 0;
  state.reconciledMissingCount = 0;
  state.reconciledRemovedCount = 0;
  state.validSubmissionCount = 0;
  state.matchingSolutions = [];
  state.matchingStats = null;
  summaryPanel.hidden = true;
  validationPanel.hidden = true;
  tableContainer.innerHTML = "";
  matchingSummary.hidden = true;
  matchingSummary.innerHTML = "";
  matchingTrace.hidden = true;
  matchingTrace.innerHTML = "";
  matchingSolutions.innerHTML = "";
  downloadButton.disabled = true;
  runMatchingButton.disabled = true;
  statusPanel.classList.remove("status-error");
}

function normalize(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[\s_]+/g, " ");
}

function normalizeCell(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function findHeader(headers, candidates) {
  const map = new Map(headers.map(h => [normalize(h), h]));
  for (const candidate of candidates) {
    const hit = map.get(normalize(candidate));
    if (hit) return hit;
  }
  return null;
}

function csvEscape(value) {
  const s = String(value ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i++;
      row.push(field);
      field = "";

      if (row.some(cell => cell.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }

  row.push(field);
  if (row.some(cell => cell.trim() !== "")) rows.push(row);

  if (rows.length < 2) return [];

  const headers = rows[0].map(h => h.trim());

  return rows.slice(1).map(values => {
    const obj = {};
    headers.forEach((header, index) => {
      obj[header] = values[index] ?? "";
    });
    return obj;
  });
}



let matchingWorker = null;

async function runMatching() {
  if (state.blockingIssues.length || !state.cleanedRows.length) return;

  runMatchingButton.disabled = true;
  matchingSummary.hidden = false;
  matchingSummary.innerHTML = `
    <div class="validation-warning">
      <strong>Solving matching problem…</strong>
    </div>
  `;
  matchingTrace.hidden = false;
  matchingTrace.innerHTML = `
    <div class="validation-warning">
      <strong>Solver trace</strong>
      <div id="solver-trace-lines"></div>
    </div>
  `;
  matchingSolutions.innerHTML = "";

  const traceLines = [];
  const appendTrace = (message) => {
    traceLines.push(message);
    const target = document.getElementById("solver-trace-lines");
    if (target) {
      target.innerHTML = `<ol>${traceLines.map(line => `<li>${escapeHtml(line)}</li>`).join("")}</ol>`;
    }
  };

  try {
    const problem = buildMatchingProblemForWorker();

    if (matchingWorker) {
      matchingWorker.terminate();
      matchingWorker = null;
    }

    matchingWorker = new Worker("proctor-matching-worker.js");

    matchingWorker.onmessage = (event) => {
      const msg = event.data || {};

      if (msg.type === "trace") {
        appendTrace(msg.message);
        return;
      }

      if (msg.type === "result") {
        state.matchingSolutions = [msg.result.allocation];
        state.matchingStats = msg.result.stats;
        renderWorkerMatchingResult(problem, msg.result);
        runMatchingButton.disabled = state.blockingIssues.length > 0 || !state.cleanedRows.length;
        matchingWorker.terminate();
        matchingWorker = null;
        return;
      }

      if (msg.type === "error") {
        appendTrace(`Stopped: ${msg.message}`);
        matchingSummary.innerHTML = `
          <div class="validation-block">
            <strong>Matching failed.</strong> ${escapeHtml(msg.message || "Unknown error.")}
          </div>
        `;
        matchingSolutions.innerHTML = "";
        runMatchingButton.disabled = state.blockingIssues.length > 0 || !state.cleanedRows.length;
        matchingWorker.terminate();
        matchingWorker = null;
      }
    };

    matchingWorker.onerror = (error) => {
      appendTrace(`Stopped: ${error.message || "Worker error."}`);
      matchingSummary.innerHTML = `
        <div class="validation-block">
          <strong>Matching failed.</strong> ${escapeHtml(error.message || "Worker error.")}
        </div>
      `;
      runMatchingButton.disabled = state.blockingIssues.length > 0 || !state.cleanedRows.length;
      if (matchingWorker) {
        matchingWorker.terminate();
        matchingWorker = null;
      }
    };

    matchingWorker.postMessage({ type: "solve", problem });
  } catch (error) {
    appendTrace(`Stopped: ${error.message || "Unknown error."}`);
    matchingSummary.innerHTML = `
      <div class="validation-block">
        <strong>Matching failed.</strong> ${escapeHtml(error.message || "Unknown error.")}
      </div>
    `;
    runMatchingButton.disabled = state.blockingIssues.length > 0 || !state.cleanedRows.length;
  }
}

function buildMatchingProblemForWorker() {
  const byProctor = new Map();
  const cohortCount = state.cohortRows.length;

  for (const row of state.cleanedRows) {
    const email = String(row["Email"] ?? "").trim().toLowerCase();
    if (!byProctor.has(email)) {
      byProctor.set(email, {
        email,
        name: row["Proctor Name"],
        submissionOrder: Number(row["Submission Order"]) || Number.MAX_SAFE_INTEGER,
        responses: new Map()
      });
    }
    byProctor.get(email).responses.set(Number(row["Cohort Index"]) - 1, row["Response"]);
  }

  const proctors = [...byProctor.values()]
    .sort((a, b) => a.submissionOrder - b.submissionOrder || a.email.localeCompare(b.email))
    .map(p => ({
      email: p.email,
      name: p.name,
      submissionOrder: p.submissionOrder,
      responses: Object.fromEntries(p.responses)
    }));

  const cohorts = state.cohortRows.map((row, index) => ({
    index,
    row,
    date: findValue(row, ["Exam Date", "Date", "Testing Date"]),
    start: findValue(row, ["Start", "Start Time"]),
    end: findValue(row, ["AES End", "End", "End Time"])
  }));

  return { proctors, cohorts };
}

function renderWorkerMatchingResult(problem, result) {
  const { proctors, cohorts } = problem;
  const allocation = result.allocation;
  const stats = result.stats;

  const covered = allocation.filter(i => i >= 0).length;
  const missing = cohorts.length - covered;

  matchingSummary.hidden = false;
  matchingSummary.innerHTML = `
    <div class="${missing ? "validation-warning" : "validation-success"}">
      <strong>Matching complete.</strong>
      Regime: ${stats.regime === "preferred-only" ? "Preferred only" : "Preferred + Available"}.
      Coverage: ${covered} / ${cohorts.length}.
      Welfare: ${stats.welfare} distinct proctors receive at least one Preferred assignment.
      Maximum workload: ${stats.maxWorkload}.
      Total workload distance from 1: ${stats.distanceFromOne}.
      ${missing ? `<strong>Warning:</strong> ${missing} cohort${missing === 1 ? "" : "s"} remain unfilled.` : ""}
    </div>
  `;

  const headers = Object.keys(cohorts[0].row);

  const allocationTable = `
    <section class="matching-solution-card">
      <div class="matching-solution-heading">
        <strong>Chosen Allocation</strong>
        <button type="button" id="exportChosenAllocation" class="btn btn-secondary btn-sm">Export Chosen Allocation CSV</button>
      </div>
      <div class="proctor-table-scroll">
        <table>
          <thead>
            <tr>
              <th>Cohort Index</th>
              ${headers.map(h => `<th>${escapeHtml(h)}</th>`).join("")}
              <th>Assigned Proctor</th>
              <th>Email</th>
              <th>Submission Order</th>
              <th>Preferred Match</th>
            </tr>
          </thead>
          <tbody>
            ${allocation.map((proctorIndex, cohortIndex) => {
              const cohort = cohorts[cohortIndex];
              if (proctorIndex < 0) {
                return `
                  <tr>
                    <td>${cohortIndex + 1}</td>
                    ${headers.map(h => `<td>${escapeHtml(cohort.row[h] ?? "")}</td>`).join("")}
                    <td><strong>UNFILLED</strong></td>
                    <td></td>
                    <td></td>
                    <td>No</td>
                  </tr>
                `;
              }

              const proctor = proctors[proctorIndex];
              const response = proctor.responses[String(cohortIndex)] ?? proctor.responses[cohortIndex];
              return `
                <tr>
                  <td>${cohortIndex + 1}</td>
                  ${headers.map(h => `<td>${escapeHtml(cohort.row[h] ?? "")}</td>`).join("")}
                  <td>${escapeHtml(proctor.name)}</td>
                  <td>${escapeHtml(proctor.email)}</td>
                  <td>${proctor.submissionOrder}</td>
                  <td>${response === "Preferred" ? "Yes" : "No"}</td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;

  const countsTable = `
    <section class="matching-solution-card">
      <div class="matching-solution-heading">
        <strong>Proctor Assignment Counts</strong>
        <button type="button" id="exportAssignmentCounts" class="btn btn-secondary btn-sm">Export Proctor Assignment Counts CSV</button>
      </div>
      <div class="proctor-table-scroll">
        <table>
          <thead>
            <tr>
              <th>Proctor Name</th>
              <th>Email</th>
              <th>Submission Order</th>
              <th>Number of Cohorts Assigned</th>
            </tr>
          </thead>
          <tbody>
            ${proctors.map((p, i) => `
              <tr>
                <td>${escapeHtml(p.name)}</td>
                <td>${escapeHtml(p.email)}</td>
                <td>${p.submissionOrder}</td>
                <td>${stats.assignmentCounts[i]}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;

  matchingSolutions.innerHTML = allocationTable + countsTable;

  const allocationExportRows = allocation.map((proctorIndex, cohortIndex) => {
    const cohort = cohorts[cohortIndex];
    const base = { "Cohort Index": cohortIndex + 1, ...cohort.row };

    if (proctorIndex < 0) {
      return {
        ...base,
        "Assigned Proctor": "UNFILLED",
        "Email": "",
        "Submission Order": "",
        "Preferred Match": "No"
      };
    }

    const proctor = proctors[proctorIndex];
    const response = proctor.responses[String(cohortIndex)] ?? proctor.responses[cohortIndex];
    return {
      ...base,
      "Assigned Proctor": proctor.name,
      "Email": proctor.email,
      "Submission Order": proctor.submissionOrder,
      "Preferred Match": response === "Preferred" ? "Yes" : "No"
    };
  });

  const countExportRows = proctors.map((p, i) => ({
    "Proctor Name": p.name,
    "Email": p.email,
    "Submission Order": p.submissionOrder,
    "Number of Cohorts Assigned": stats.assignmentCounts[i]
  }));

  document.getElementById("exportChosenAllocation")?.addEventListener("click", () => {
    downloadCsv("chosen-proctor-allocation.csv", allocationExportRows);
  });

  document.getElementById("exportAssignmentCounts")?.addEventListener("click", () => {
    downloadCsv("proctor-assignment-counts.csv", countExportRows);
  });
}

function downloadCsv(filename, rows) {
  if (!rows || !rows.length) return;

  const headers = Object.keys(rows[0]);
  const escapeCsv = value => {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const csv = [
    headers.map(escapeCsv).join(","),
    ...rows.map(row => headers.map(h => escapeCsv(row[h])).join(","))
  ].join("\r\n");

  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function findValue(row, candidates) {
  const keys = Object.keys(row);
  const map = new Map(keys.map(k => [normalize(k), k]));
  for (const candidate of candidates) {
    const key = map.get(normalize(candidate));
    if (key) return row[key];
  }
  return "";
}
