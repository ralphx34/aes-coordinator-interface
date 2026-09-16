/*
 * Individual Netlify submission lookup, separate from proctor matching.
 * Reads the uploaded export locally. Does not modify matching state, data,
 * validation, cleaned output, or FCFS ordering.
 */
(() => {
  "use strict";

  const upload = document.getElementById("netlify-upload");
  const panel = document.getElementById("submission-lookup");
  const search = document.getElementById("submission-search");
  const results = document.getElementById("submission-results");
  if (!upload || !panel || !search || !results) return;

  let submissions = [];
  let columns = [];
  let nameColumn = "";
  let emailColumn = "";
  let payloadColumn = "";
  let timeColumn = "";
  let currentRead = 0;

  function normalized(value) {
    return String(value ?? "").trim().toLowerCase().replace(/[\s_]+/g, " ");
  }

  function header(candidates) {
    return columns.find(column => candidates.some(candidate => normalized(column) === normalized(candidate))) || "";
  }

  // Keep the same CSV quoting conventions as the existing Netlify parser.
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

    const headers = rows[0].map(cell => cell.trim());
    if (new Set(headers).size !== headers.length) {
      throw new Error("The Netlify export contains duplicate column headers.");
    }
    return rows.slice(1).map(values => {
      const record = {};
      headers.forEach((column, index) => {
        record[column] = values[index] ?? "";
      });
      return record;
    });
  }

  function csvEscape(value) {
    const text = String(value ?? "");
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function paragraph(text) {
    const p = document.createElement("p");
    p.textContent = text;
    return p;
  }

  function validPayload(record) {
    if (!String(record[nameColumn] ?? "").trim() ||
        !String(record[emailColumn] ?? "").trim() ||
        !String(record[payloadColumn] ?? "").trim()) return false;
    try {
      return Array.isArray(JSON.parse(record[payloadColumn]));
    } catch {
      return false;
    }
  }

  async function loadExport() {
    const request = ++currentRead;
    submissions = [];
    columns = [];
    panel.hidden = true;
    search.value = "";
    results.replaceChildren();

    const file = upload.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      if (request !== currentRead) return;
      const rows = parseCsv(text);
      if (!rows.length) throw new Error("The Netlify export contains no submissions.");

      columns = Object.keys(rows[0]);
      nameColumn = header(["name", "Full Name"]);
      emailColumn = header(["email", "University Email"]);
      payloadColumn = header(["preference_payload", "Preference Payload"]);
      timeColumn = header(["created_at", "Created At", "submitted_at", "Submitted At", "submission_created_at", "Submission Created At"]);
      if (!nameColumn || !emailColumn || !payloadColumn) {
        throw new Error("The Netlify export must contain name, email, and preference_payload columns.");
      }

      submissions = rows;
      panel.hidden = false;
      results.appendChild(paragraph(`${rows.length} submissions loaded. Search by name or email to download one person's submission.`));
    } catch (error) {
      if (request !== currentRead) return;
      submissions = [];
      columns = [];
      panel.hidden = false;
      results.appendChild(paragraph(`Submission lookup could not load this file: ${error.message}`));
    }
  }

  function renderResults() {
    results.replaceChildren();
    const query = search.value.trim().toLowerCase();
    if (!submissions.length) return;
    if (query.length < 2) {
      results.appendChild(paragraph("Enter at least 2 characters to search."));
      return;
    }

    const matches = submissions.map((record, index) => ({record, index}))
      .filter(({record}) =>
        String(record[nameColumn] ?? "").toLowerCase().includes(query) ||
        String(record[emailColumn] ?? "").toLowerCase().includes(query)
      )
      .sort((a, b) => {
        const first = timeColumn ? Date.parse(a.record[timeColumn]) : NaN;
        const second = timeColumn ? Date.parse(b.record[timeColumn]) : NaN;
        if (Number.isFinite(first) && Number.isFinite(second)) return second - first || b.index - a.index;
        return b.index - a.index;
      });

    if (!matches.length) {
      results.appendChild(paragraph("No matching submissions found."));
      return;
    }

    const visible = matches.slice(0, 50);
    results.appendChild(paragraph(`${matches.length} matching submission${matches.length === 1 ? "" : "s"}. ${matches.length > 50 ? "Showing the first 50; refine your search." : "If someone submitted more than once, choose the appropriate submission by its timestamp (newest shown first)."}`));

    const wrapper = document.createElement("div");
    wrapper.className = "proctor-table-scroll";
    const table = document.createElement("table");
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    ["Name", "Email", "Submitted", "Export"].forEach(label => {
      const cell = document.createElement("th");
      cell.textContent = label;
      headRow.appendChild(cell);
    });
    head.appendChild(headRow);
    table.appendChild(head);
    const body = document.createElement("tbody");

    visible.forEach(({record, index}) => {
      const row = document.createElement("tr");
      [record[nameColumn], record[emailColumn], timeColumn ? record[timeColumn] : "Time unavailable"].forEach(value => {
        const cell = document.createElement("td");
        cell.textContent = String(value ?? "");
        row.appendChild(cell);
      });
      const action = document.createElement("td");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "secondary-button";
      button.textContent = validPayload(record) ? "Download submission" : "Invalid submission";
      button.disabled = !validPayload(record);
      button.dataset.submissionIndex = String(index);
      action.appendChild(button);
      row.appendChild(action);
      body.appendChild(row);
    });
    table.appendChild(body);
    wrapper.appendChild(table);
    results.appendChild(wrapper);
  }

  function downloadSubmission(index) {
    if (!Number.isInteger(index) || index < 0 || index >= submissions.length) return;
    const record = submissions[index];
    if (!validPayload(record)) return;

    // Only include fields required by the proctor-facing revision importer, plus
    // exam period and timestamp where available. Omit IP, browser metadata, etc.
    const periodColumn = header(["exam_period", "Exam Period"]);
    const included = new Set([nameColumn, emailColumn, payloadColumn, periodColumn, timeColumn].filter(Boolean));
    const exportColumns = columns.filter(column => included.has(column));
    const content = [exportColumns.map(csvEscape).join(","),
      exportColumns.map(column => csvEscape(record[column])).join(",")].join("\r\n");
    const localPart = String(record[emailColumn]).split("@")[0]
      .replace(/[^a-z0-9_-]/gi, "-").slice(0, 50) || "proctor";
    const blob = new Blob(["\uFEFF", content], {type: "text/csv;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `aes-submission-${localPart}-${index + 1}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  upload.addEventListener("change", loadExport);
  search.addEventListener("input", renderResults);
  results.addEventListener("click", event => {
    const button = event.target.closest("button[data-submission-index]");
    if (!button || button.disabled || !results.contains(button)) return;
    downloadSubmission(Number(button.dataset.submissionIndex));
  });
})();
