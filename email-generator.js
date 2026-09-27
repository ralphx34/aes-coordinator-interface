const cohortCsvUpload = document.getElementById("cohort-csv-upload");
const emailGeneratorStatus = document.getElementById("email-generator-status");
const emailCohortTable = document.getElementById("email-cohort-table");
const instructorEmailSection = document.getElementById("instructor-email-section");
const emailPreviewPanel = document.getElementById("email-preview-panel");
const emailPreviewHeading = document.getElementById("email-preview-heading");
const emailPreview = document.getElementById("email-preview");
const copyEmailButton = document.getElementById("copy-email-button");
const closeEmailPreviewButton = document.getElementById("close-email-preview");

const REQUIRED_COHORT_COLUMNS = ["Instructors", "Course", "Section", "Exam Date", "Start", "AES End", "Room Size"];
let emailCohorts = [];
let instructorGroups = [];
let currentEmailMode = "aes";

cohortCsvUpload.addEventListener("change", async () => {
    const file = cohortCsvUpload.files?.[0];
    if (!file) return;
    try {
        const rows = parseCsv(await file.text());
        validateCohortRows(rows);
        emailCohorts = rows.map((row, index) => ({
            ...row,
            _index: index,
            _room: "",
            _proctorName: ""
        }));
        instructorGroups = buildInstructorGroups(emailCohorts);
        renderEmailCohorts();
        renderEmailActions();
        hideEmailPreview();
        setEmailGeneratorStatus(`Loaded ${rows.length} testing cohort${rows.length === 1 ? "" : "s"}.`);
    } catch (error) {
        emailCohorts = [];
        instructorGroups = [];
        emailCohortTable.innerHTML = "";
        instructorEmailSection.innerHTML = "";
        hideEmailPreview();
        setEmailGeneratorStatus(error.message || "Could not load the CSV.", true);
    } finally {
        cohortCsvUpload.value = "";
    }
});

copyEmailButton.addEventListener("click", copyRichEmail);
closeEmailPreviewButton.addEventListener("click", hideEmailPreview);

function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let quoted = false;
    const input = text.replace(/^\uFEFF/, "");
    for (let index = 0; index < input.length; index += 1) {
        const character = input[index];
        if (quoted) {
            if (character === '"' && input[index + 1] === '"') {
                field += '"';
                index += 1;
            } else if (character === '"') {
                quoted = false;
            } else {
                field += character;
            }
        } else if (character === '"') {
            quoted = true;
        } else if (character === ",") {
            row.push(field);
            field = "";
        } else if (character === "\n") {
            row.push(field.replace(/\r$/, ""));
            rows.push(row);
            row = [];
            field = "";
        } else {
            field += character;
        }
    }
    if (quoted) throw new Error("The CSV contains an unclosed quoted field.");
    if (field !== "" || row.length > 0) {
        row.push(field.replace(/\r$/, ""));
        rows.push(row);
    }
    const nonemptyRows = rows.filter(values => values.some(value => String(value).trim() !== ""));
    if (nonemptyRows.length < 2) throw new Error("The CSV does not contain any testing cohorts.");
    const headers = nonemptyRows[0].map(header => header.trim());
    return nonemptyRows.slice(1).map(values =>
        Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]))
    );
}

function validateCohortRows(rows) {
    const columns = new Set(Object.keys(rows[0] || {}));
    const missing = REQUIRED_COHORT_COLUMNS.filter(column => !columns.has(column));
    if (missing.length) {
        throw new Error(`The CSV is missing required column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`);
    }
}

function splitAlignedValues(value) {
    return String(value || "").split(",").map(part => part.trim()).filter(Boolean);
}

function cohortContributors(cohort) {
    const instructors = splitAlignedValues(cohort.Instructors);
    const courses = splitAlignedValues(cohort.Course);
    const sections = splitAlignedValues(cohort.Section);
    const count = Math.max(instructors.length, courses.length, sections.length);
    return Array.from({ length: count }, (_, index) => ({
        instructor: instructors[index] || instructors[0] || "Instructor",
        course: courses[index] || courses[0] || "",
        section: sections[index] || sections[0] || ""
    }));
}

function buildInstructorGroups(cohorts) {
    const groups = new Map();
    cohorts.forEach(cohort => {
        cohortContributors(cohort).forEach(contributor => {
            if (!groups.has(contributor.instructor)) {
                groups.set(contributor.instructor, {
                    instructor: contributor.instructor,
                    greetingName: firstName(contributor.instructor),
                    examNumber: "",
                    assignments: []
                });
            }
            groups.get(contributor.instructor).assignments.push({ cohort, contributor });
        });
    });
    return [...groups.values()];
}

function renderEmailCohorts() {
    const body = emailCohorts.map((cohort, index) => `
        <tr>
            <td>
                <strong>${escapeHtml(cohort.Course)} Â· Section ${escapeHtml(cohort.Section)}</strong><br>
                <span>${escapeHtml(cohort.Instructors)}</span><br>
                <span>${escapeHtml(formatExamDate(cohort["Exam Date"]))}, ${escapeHtml(cohort.Start)} &ndash; ${escapeHtml(cohort["AES End"])}</span>
            </td>
            <td><input class="email-field cohort-room" data-index="${index}" placeholder="e.g., LH 120"></td>
            <td><input class="email-field cohort-proctor" data-index="${index}" placeholder="Proctor name"></td>
        </tr>`).join("");
    emailCohortTable.innerHTML = `
        <h2>Cohort Setup</h2>
        <p class="email-section-note">Enter each assigned room and proctor once. These values are reused in both email types.</p>
        <table class="email-generator-table email-setup-table">
            <thead><tr><th>Assignment</th><th>Room</th><th>Proctor</th></tr></thead>
            <tbody>${body}</tbody>
        </table>`;
    bindCohortInputs(".cohort-room", "_room");
    bindCohortInputs(".cohort-proctor", "_proctorName");
}

function bindCohortInputs(selector, property) {
    emailCohortTable.querySelectorAll(selector).forEach(input => {
        input.addEventListener("input", () => {
            emailCohorts[Number(input.dataset.index)][property] = input.value;
        });
    });
}

function renderEmailActions() {
    instructorEmailSection.className = "instructor-email-section";
    instructorEmailSection.innerHTML = `
        <h2>Generate Emails</h2>
        <div class="email-type-tabs" role="tablist" aria-label="Email type">
            <button type="button" class="email-type-tab ${currentEmailMode === "aes" ? "active" : ""}" data-mode="aes">AES Information Emails</button>
            <button type="button" class="email-type-tab ${currentEmailMode === "proctor" ? "active" : ""}" data-mode="proctor">Proctor Assignment Emails</button>
        </div>
        <div id="email-action-list">${currentEmailMode === "aes" ? buildAesEmailRows() : buildProctorEmailRows()}</div>`;

    instructorEmailSection.querySelectorAll(".email-type-tab").forEach(button => {
        button.addEventListener("click", () => {
            currentEmailMode = button.dataset.mode;
            renderEmailActions();
        });
    });
    instructorEmailSection.querySelectorAll(".instructor-exam-number").forEach(input => {
        input.addEventListener("input", () => { instructorGroups[Number(input.dataset.index)].examNumber = input.value; });
    });
    instructorEmailSection.querySelectorAll(".generate-instructor-email").forEach(button => {
        button.addEventListener("click", () => showInstructorEmail(Number(button.dataset.index)));
    });
    instructorEmailSection.querySelectorAll(".generate-proctor-email").forEach(button => {
        button.addEventListener("click", () => showProctorEmail(Number(button.dataset.index)));
    });
}

function buildAesEmailRows() {
    return `
        <table class="email-generator-table email-action-table">
            <thead><tr><th>Instructor</th><th>Assignments</th><th>Exam Number</th><th></th></tr></thead>
            <tbody>
                ${instructorGroups.map((group, index) => `
                    <tr>
                        <td><strong>${escapeHtml(group.instructor)}</strong></td>
                        <td>${group.assignments.length}</td>
                        <td><input class="email-field instructor-exam-number" data-index="${index}" value="${escapeHtml(group.examNumber)}" placeholder="e.g., 1"></td>
                        <td><button type="button" class="export-button generate-instructor-email" data-index="${index}">Generate AES Information Email</button></td>
                    </tr>`).join("")}
            </tbody>
        </table>`;
}

function buildProctorEmailRows() {
    return `
        <table class="email-generator-table email-action-table">
            <thead><tr><th>Assignment</th><th>Proctor</th><th></th></tr></thead>
            <tbody>
                ${emailCohorts.map((cohort, index) => `
                    <tr>
                        <td><strong>${escapeHtml(cohort.Course)} Â· Section ${escapeHtml(cohort.Section)}</strong><br>${escapeHtml(formatExamDate(cohort["Exam Date"]))}, ${escapeHtml(cohort.Start)} &ndash; ${escapeHtml(cohort["AES End"])}</td>
                        <td>${escapeHtml(cohort._proctorName || "Not entered")}</td>
                        <td><button type="button" class="export-button generate-proctor-email" data-index="${index}">Generate Proctor Assignment Email</button></td>
                    </tr>`).join("")}
            </tbody>
        </table>`;
}

function showInstructorEmail(index) {
    const group = instructorGroups[index];
    const examNumber = group.examNumber.trim() || "(Number)";
    const assignments = group.assignments.map(({ cohort, contributor }, assignmentIndex) => `
        <p><strong>Assignment ${assignmentIndex + 1}:</strong></p>
        <ul>
            <li><strong>Course:</strong> ${escapeHtml(contributor.course)} &nbsp;&nbsp; Section #${escapeHtml(contributor.section)}</li>
            <li><strong>Date:</strong> ${escapeHtml(formatExamDate(cohort["Exam Date"]))}</li>
            <li><strong>Room:</strong> ${escapeHtml(cohort._room.trim() || "(Insert room)")}</li>
            <li><strong>Time:</strong> ${escapeHtml(cohort.Start)} &ndash; ${escapeHtml(cohort["AES End"])}</li>
        </ul>
        <p><strong>Students:</strong></p><ul><li>(Insert students)</li></ul>`).join("");
    showEmailPreview(`AES Information Email - ${group.instructor}`, `
        <p><strong>Subject: Exam ${escapeHtml(examNumber)} AES Information</strong></p>
        <p>Hello ${escapeHtml(group.greetingName || "(Name)")},</p>
        <p>I am writing to provide the official AES assignment for your upcoming exam. Please see the assignment information below:</p>
        ${assignments}
        <p>Please confirm with the students listed above that they are available to take the exam at the assigned time. If any student is unable to attend at the scheduled time, please let me know as soon as possible so that we can determine whether alternative arrangements are necessary.</p>
        <p>I will follow up later this week with your assigned proctors and any additional proctoring information.</p>
        <p>Please let me know if you notice any issues with the assignment or student list. If you have any questions or concerns, please feel free to reach out any time. Thank you!</p>
        <p>Best,<br>Ralph Fernando</p>`);
}

function showProctorEmail(index) {
    const cohort = emailCohorts[index];
    if (!cohort._room.trim() || !cohort._proctorName.trim()) {
        setEmailGeneratorStatus("Enter both the room and proctor name before generating the Proctor Assignment Email.", true);
        return;
    }
    const courseSection = cohortContributors(cohort)
        .map(item => `${item.course} Section #${item.section}`)
        .join("; ");
    showEmailPreview(`Proctor Assignment Email - ${courseSection}`, `
        <p><strong>Subject: AES Exam Proctor Assignment &ndash; ${escapeHtml(courseSection)}</strong></p>
        <p>Hello ${escapeHtml(jointGreetingForCohort(cohort) || "(Name)")},</p>
        <p>I am writing to confirm that ${escapeHtml(cohort._proctorName)}, who is CC'd on this email, has been assigned to proctor the following upcoming AES exam. The assignment details are as follows:</p>
        <p><strong>Assignment:</strong></p>
        <ul>
            <li><strong>Course:</strong> ${escapeHtml(courseSection)}</li>
            <li><strong>Date:</strong> ${escapeHtml(formatExamDate(cohort["Exam Date"]))}</li>
            <li><strong>Room:</strong> ${escapeHtml(cohort._room)}</li>
            <li><strong>Time:</strong> ${escapeHtml(cohort.Start)} &ndash; ${escapeHtml(cohort["AES End"])}</li>
        </ul>
        <p>${escapeHtml(cohort._proctorName)}, could you please reply to this email to confirm your availability for this assignment?</p>
        <p>If either of you has any questions or concerns regarding the arrangements, please let me know. Thank you!</p>
        <p>Best,<br>Ralph Fernando</p>`);
}

function showEmailPreview(heading, html) {
    setEmailGeneratorStatus("Email generated. Review it below before copying.");
    emailPreviewHeading.textContent = heading;
    emailPreview.innerHTML = html;
    emailPreviewPanel.classList.remove("hidden");
    emailPreviewPanel.scrollIntoView({ behavior: "smooth", block: "start" });
}

function hideEmailPreview() {
    emailPreviewPanel.classList.add("hidden");
    emailPreviewHeading.textContent = "";
    emailPreview.innerHTML = "";
}

async function copyRichEmail() {
    const html = emailPreview.innerHTML;
    const text = emailPreview.innerText;
    try {
        if (navigator.clipboard && window.ClipboardItem) {
            await navigator.clipboard.write([new ClipboardItem({
                "text/html": new Blob([html], { type: "text/html" }),
                "text/plain": new Blob([text], { type: "text/plain" })
            })]);
        } else {
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(emailPreview);
            selection.removeAllRanges();
            selection.addRange(range);
            document.execCommand("copy");
            selection.removeAllRanges();
        }
        copyEmailButton.textContent = "Copied";
        window.setTimeout(() => { copyEmailButton.textContent = "Copy Email"; }, 1500);
    } catch {
        setEmailGeneratorStatus("The automatic copy failed. Select the preview and copy it manually.", true);
    }
}

function jointGreetingForCohort(cohort) {
    const names = [...new Set(cohortContributors(cohort).map(contributor => {
        const group = instructorGroups.find(item => item.instructor === contributor.instructor);
        return group?.greetingName || firstName(contributor.instructor);
    }))];
    if (names.length <= 1) return names[0] || "";
    if (names.length === 2) return `${names[0]} and ${names[1]}`;
    return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

function firstName(fullName) {
    return String(fullName || "").trim().split(/\s+/)[0] || "";
}

function formatExamDate(value) {
    const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return value || "";
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(date);
    const month = new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(date);
    const day = Number(match[3]);
    return `${weekday} ${month} ${day}${ordinalSuffix(day)}`;
}

function ordinalSuffix(day) {
    const remainder100 = day % 100;
    if (remainder100 >= 11 && remainder100 <= 13) return "th";
    return { 1: "st", 2: "nd", 3: "rd" }[day % 10] || "th";
}

function setEmailGeneratorStatus(message, isError = false) {
    emailGeneratorStatus.textContent = message;
    emailGeneratorStatus.classList.toggle("status-error", isError);
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}