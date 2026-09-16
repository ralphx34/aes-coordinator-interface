console.log("AES Coordinator loaded.");

const upload = document.getElementById("json-upload");
const status = document.getElementById("status");
const searchBox = document.getElementById("search-box");
const tableContainer = document.getElementById("data-table");
const detailedViewButton = document.getElementById("detailed-view-button");
const planningViewButton = document.getElementById("planning-view-button");
const viewDescription = document.getElementById("view-description");

const resumeControl = document.createElement("div");
resumeControl.id = "resume-control";
resumeControl.className = "resume-control";
resumeControl.innerHTML = `
    <label class="cohort-button cohort-load-label" id="resume-cohorts-label">
        Load Previous Cohort
        <input id="resume-cohorts-input" type="file" accept=".json,application/json">
    </label>
`;
status.insertAdjacentElement("afterend", resumeControl);

const resumeCohortsInput = document.getElementById("resume-cohorts-input");

const updateSummaryPanel = document.createElement("div");
updateSummaryPanel.id = "update-summary-panel";
updateSummaryPanel.className = "update-summary-panel hidden";
resumeControl.insertAdjacentElement("afterend", updateSummaryPanel);

const examDateControl = document.createElement("div");
examDateControl.id = "exam-date-control";
examDateControl.className = "exam-date-control";
examDateControl.innerHTML = `
    <label for="exam-date-select">Exam Date</label>
    <select id="exam-date-select" disabled>
        <option value="">No exam dates loaded</option>
    </select>
`;
viewDescription.insertAdjacentElement("afterend", examDateControl);

const examDateSelect = document.getElementById("exam-date-select");

const cohortControl = document.createElement("div");
cohortControl.id = "cohort-control";
cohortControl.className = "cohort-control hidden";
cohortControl.innerHTML = `
    <button type="button" class="cohort-button" id="cohort-button">
        Group Testing Cohorts
    </button>
    <button type="button" class="cohort-button hidden" id="manual-cohort-button">
        Manually Edit Cohorts
    </button>
    <label class="cohort-button cohort-load-label hidden" id="load-cohorts-label">
        Load Previous Cohort
        <input id="load-cohorts-input" type="file" accept=".json,application/json">
    </label>
    <button type="button" class="cohort-button hidden" id="reset-cohorts-button">
        Reset Cohorts
    </button>
`;
examDateControl.insertAdjacentElement("afterend", cohortControl);

const cohortButton = document.getElementById("cohort-button");
const manualCohortButton = document.getElementById("manual-cohort-button");
const loadCohortsLabel = document.getElementById("load-cohorts-label");
const loadCohortsInput = document.getElementById("load-cohorts-input");
const resetCohortsButton = document.getElementById("reset-cohorts-button");

const planningDateFilter = document.createElement("div");
planningDateFilter.id = "planning-date-filter";
planningDateFilter.className = "planning-date-filter hidden";
planningDateFilter.innerHTML = `
    <div class="planning-date-field">
        <label for="planning-date-start">From</label>
        <input id="planning-date-start" type="date">
    </div>
    <div class="planning-date-field">
        <label for="planning-date-end">To</label>
        <input id="planning-date-end" type="date">
    </div>
    <button type="button" id="planning-date-clear" class="planning-date-clear">
        Clear Dates
    </button>
`;
cohortControl.insertAdjacentElement("afterend", planningDateFilter);

const planningDateStart = document.getElementById("planning-date-start");
const planningDateEnd = document.getElementById("planning-date-end");
const planningDateClear = document.getElementById("planning-date-clear");

const exportControl = document.createElement("div");
exportControl.id = "export-control";
exportControl.className = "export-control";
exportControl.innerHTML = `
    <button type="button" id="export-current-view" class="export-button" disabled>
        Export Current View
    </button>
    <button type="button" id="export-session-json" class="export-button" disabled>
        Export Session JSON
    </button>
`;
planningDateFilter.insertAdjacentElement("afterend", exportControl);

const exportCurrentViewButton = document.getElementById("export-current-view");
const exportSessionJsonButton = document.getElementById("export-session-json");

const finalsSettingsControl = document.createElement("div");
finalsSettingsControl.id = "finals-settings-control";
finalsSettingsControl.className = "finals-settings-control";
finalsSettingsControl.innerHTML = `
    <button type="button" id="finals-settings-button" class="cohort-button">
        Finals Week Settings
    </button>
`;
exportControl.insertAdjacentElement("afterend", finalsSettingsControl);

const finalsSettingsButton = document.getElementById("finals-settings-button");

const finalsSettingsPanel = document.createElement("div");
finalsSettingsPanel.id = "finals-settings-panel";
finalsSettingsPanel.className = "finals-settings-panel hidden";
finalsSettingsControl.insertAdjacentElement("afterend", finalsSettingsPanel);

const manualCohortActionBar = document.createElement("div");
manualCohortActionBar.id = "manual-cohort-action-bar";
manualCohortActionBar.className = "manual-cohort-action-bar hidden";
manualCohortActionBar.innerHTML = `
    <div class="manual-cohort-action-status" id="manual-cohort-action-status">
        0 cohorts selected · 0 students selected
    </div>
    <div class="manual-cohort-action-buttons">
        <button type="button" id="combine-selected-cohorts" class="cohort-button" disabled>
            Combine Cohorts
        </button>
        <button type="button" id="combine-selected-students" class="cohort-button" disabled>
            Create Cohort from Students
        </button>
    </div>
`;
document.body.appendChild(manualCohortActionBar);

const manualCohortActionStatus = document.getElementById("manual-cohort-action-status");
const combineSelectedCohortsButton = document.getElementById("combine-selected-cohorts");
const combineSelectedStudentsButton = document.getElementById("combine-selected-students");

let submissions = [];
let detailedRows = [];
let planningRows = [];
let currentView = "detailed";
let selectedExamDate = "";
let cohortMode = false;
let manualCohortEditMode = false;
let expandedCohorts = new Set();
let manualCohortAssignments = new Map();
let customCohortMeta = new Map();
let selectedCohortKeys = new Set();
let selectedStudentKeys = new Set();
let roomSizeOverrides = new Map();
let currentDisplayedRows = [];
let currentDisplayedColumns = [];
let currentSortColumn = null;
let currentSortAscending = true;
let lastUpdateSummary = { automatic: [], review: [] };
let finalsWeekStart = "";
let finalsWeekEnd = "";
let finalExamCourseTimes = new Map();
let finalsDraftWeekStart = "";
let finalsDraftWeekEnd = "";
let finalsDraftCourseTimes = new Map();

upload.addEventListener("change", async () => {
    const files = [...upload.files];

    if (files.length === 0) {
        return;
    }

    status.classList.remove("status-error");
    status.textContent = `Loading ${files.length} file${files.length === 1 ? "" : "s"}...`;

    try {
        const loaded = await Promise.all(files.map(readJsonFile));
        const incoming = loaded.map(item => normalizeSubmission(item.data, item.filename));

        if (submissions.length === 0) {
            submissions = incoming;
            detailedRows = buildDetailedView(submissions);
            planningRows = buildPlanningView(detailedRows);
            manualCohortAssignments.clear();
            customCohortMeta.clear();
            roomSizeOverrides.clear();

            lastUpdateSummary = {
                automatic: incoming.map(submission =>
                    `Added ${submissionLabel(submission)} with ${submission.planningTotal} AES student slot${submission.planningTotal === 1 ? "" : "s"}.`
                ),
                review: []
            };
        } else {
            lastUpdateSummary = reconcileIncomingSubmissions(incoming);
        }

        currentSortColumn = null;
        currentSortAscending = true;
        searchBox.value = "";
        searchBox.disabled = false;

        populateExamDateSelector();
        renderUpdateSummary(lastUpdateSummary);
        if (!finalsSettingsPanel.classList.contains("hidden")) {
            renderFinalsSettingsPanel();
        }
        renderCurrentView();

        const sectionCount = submissions.length;
        const studentSlots = countUniqueStudentSlots(detailedRows);
        const examPlanningRows = planningRows.length;

        status.textContent =
            `Current workspace contains ${sectionCount} section${sectionCount === 1 ? "" : "s"}, ` +
            `${studentSlots} AES student slot${studentSlots === 1 ? "" : "s"}, and ` +
            `${examPlanningRows} planning exam row${examPlanningRows === 1 ? "" : "s"}.`;
    } catch (error) {
        status.textContent = error.message;
        status.classList.add("status-error");
    } finally {
        upload.value = "";
    }
});

searchBox.addEventListener("input", renderCurrentView);

examDateSelect.addEventListener("change", () => {
    selectedExamDate = examDateSelect.value;
    currentSortColumn = null;
    currentSortAscending = true;
    renderCurrentView();
});

detailedViewButton.addEventListener("click", () => switchView("detailed"));
planningViewButton.addEventListener("click", () => switchView("planning"));

cohortButton.addEventListener("click", () => {
    cohortMode = !cohortMode;
    manualCohortEditMode = false;
    selectedCohortKeys.clear();
    selectedStudentKeys.clear();
    expandedCohorts.clear();
    currentSortColumn = cohortMode ? "Exam Date" : null;
    currentSortAscending = true;
    searchBox.value = "";
    updateCohortButton();
    renderCurrentView();
});

planningDateStart.addEventListener("change", renderCurrentView);
planningDateEnd.addEventListener("change", renderCurrentView);

planningDateClear.addEventListener("click", () => {
    planningDateStart.value = "";
    planningDateEnd.value = "";
    renderCurrentView();
});


manualCohortButton.addEventListener("click", () => {
    manualCohortEditMode = !manualCohortEditMode;
    selectedCohortKeys.clear();
    selectedStudentKeys.clear();
    updateCohortControls();
    renderCurrentView();
});

async function handleCohortPlanFile(file) {
    if (!file) return;

    try {
        const data = JSON.parse(await file.text());
        loadCohortPlanObject(data);
    } catch (error) {
        alert(error.message || "Could not load the cohort file.");
    }
}

loadCohortsInput.addEventListener("change", async event => {
    await handleCohortPlanFile(event.target.files?.[0]);
    loadCohortsInput.value = "";
});

resumeCohortsInput.addEventListener("change", async event => {
    await handleCohortPlanFile(event.target.files?.[0]);
    resumeCohortsInput.value = "";
});

resetCohortsButton.addEventListener("click", resetManualCohorts);

exportCurrentViewButton.addEventListener("click", handleExportCurrentView);
exportSessionJsonButton.addEventListener("click", downloadCohortPlan);
combineSelectedCohortsButton.addEventListener("click", combineSelectedCohorts);
combineSelectedStudentsButton.addEventListener(
    "click",
    combineSelectedStudentsIntoCustomCohort
);

finalsSettingsButton.addEventListener("click", () => {
    if (finalsSettingsPanel.classList.contains("hidden")) {
        finalsDraftWeekStart = finalsWeekStart;
        finalsDraftWeekEnd = finalsWeekEnd;
        finalsDraftCourseTimes = new Map(finalExamCourseTimes);
        renderFinalsSettingsPanel();
    }
    finalsSettingsPanel.classList.toggle("hidden");
});

function switchView(view) {
    currentView = view;
    currentSortColumn = null;
    currentSortAscending = true;
    searchBox.value = "";

    detailedViewButton.classList.toggle("active", view === "detailed");
    planningViewButton.classList.toggle("active", view === "planning");

    if (view === "detailed") {
        cohortMode = false;
        manualCohortEditMode = false;
        selectedCohortKeys.clear();
        expandedCohorts.clear();
        viewDescription.innerHTML =
            `Detailed View shows student-level AES information for one exam date at a time. Select an exam date below to change the displayed records. If an instructor reports more AES students than they can identify individually, placeholder rows are included as <strong>No student information</strong>.`;
        examDateControl.classList.remove("hidden");
        cohortControl.classList.add("hidden");
        planningDateFilter.classList.add("hidden");
    } else {
        viewDescription.textContent =
            "Planning View groups each section by exam date, counts AES student slots, and retains only the information needed for scheduling. Use Group Testing Cohorts to combine compatible testing groups while keeping instructor and section details available on demand.";
        examDateControl.classList.add("hidden");
        cohortControl.classList.remove("hidden");
        planningDateFilter.classList.remove("hidden");
        updateCohortButton();
    }

    renderCurrentView();
}

function updateCohortControls() {
    cohortButton.textContent = cohortMode
        ? "Show Instructor Planning View"
        : "Group Testing Cohorts";
    cohortButton.classList.toggle("active", cohortMode);

    const showCohortActions = currentView === "planning" && cohortMode;
    manualCohortButton.classList.toggle("hidden", !showCohortActions);
    loadCohortsLabel.classList.toggle("hidden", !showCohortActions);
    resetCohortsButton.classList.toggle("hidden", !showCohortActions);

    manualCohortButton.textContent = manualCohortEditMode
        ? "Finish Editing Cohorts"
        : "Manually Edit Cohorts";
    manualCohortButton.classList.toggle("active", manualCohortEditMode);

    const showActionBar = showCohortActions && manualCohortEditMode;
    manualCohortActionBar.classList.toggle("hidden", !showActionBar);

    const selectedCount = selectedCohortKeys.size;
    const selectedStudentCount = selectedStudentKeys.size;

    manualCohortActionStatus.textContent =
        `${selectedCount} cohort${selectedCount === 1 ? "" : "s"} · ` +
        `${selectedStudentCount} student${selectedStudentCount === 1 ? "" : "s"}`;

    combineSelectedCohortsButton.disabled = selectedCount < 2;
    combineSelectedStudentsButton.disabled = selectedStudentCount < 1;
}

function updateCohortButton() {
    updateCohortControls();
}

function resetData() {
    currentDisplayedRows = [];
    currentDisplayedColumns = [];
    exportCurrentViewButton.disabled = true;
    planningDateStart.value = "";
    planningDateEnd.value = "";
    submissions = [];
    detailedRows = [];
    planningRows = [];
    selectedExamDate = "";
    cohortMode = false;
    expandedCohorts.clear();
    updateCohortButton();
    currentSortColumn = null;
    currentSortAscending = true;
    searchBox.value = "";
    searchBox.disabled = true;
    tableContainer.innerHTML = "";
    status.textContent = "No files loaded.";
    status.classList.remove("status-error");
    lastUpdateSummary = { automatic: [], review: [] };
    finalsWeekStart = "";
    finalsWeekEnd = "";
    finalExamCourseTimes = new Map();
    finalsDraftWeekStart = "";
    finalsDraftWeekEnd = "";
    finalsDraftCourseTimes = new Map();
    finalsSettingsPanel.classList.add("hidden");
    finalsSettingsPanel.innerHTML = "";
    updateSummaryPanel.classList.add("hidden");
    updateSummaryPanel.innerHTML = "";
    resetExamDateSelector();
}

function resetExamDateSelector() {
    examDateSelect.innerHTML = `<option value="">No exam dates loaded</option>`;
    examDateSelect.disabled = true;
    selectedExamDate = "";
}

function populateExamDateSelector() {
    const dates = [...new Set(
        detailedRows
            .map(row => row["Exam Date"])
            .filter(Boolean)
    )].sort();

    examDateSelect.innerHTML = "";

    if (dates.length === 0) {
        resetExamDateSelector();
        return;
    }

    const allOption = document.createElement("option");
    allOption.value = "__ALL__";
    allOption.textContent = "Include All";
    examDateSelect.appendChild(allOption);

    for (const date of dates) {
        const option = document.createElement("option");
        option.value = date;
        option.textContent = formatDate(date);
        examDateSelect.appendChild(option);
    }

    if (selectedExamDate !== "__ALL__" && !dates.includes(selectedExamDate)) {
        selectedExamDate = dates[0];
    }

    examDateSelect.value = selectedExamDate;
    examDateSelect.disabled = false;
}

function readJsonFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => {
            try {
                const data = JSON.parse(reader.result);
                resolve({ data, filename: file.name });
            } catch {
                reject(new Error(`Could not parse "${file.name}" as JSON.`));
            }
        };

        reader.onerror = () => {
            reject(new Error(`Could not read "${file.name}".`));
        };

        reader.readAsText(file);
    });
}


function normalizeIdentityPart(value) {
    return clean(value).toLowerCase().replace(/\s+/g, " ");
}

function submissionIdentity(submission) {
    return [
        normalizeIdentityPart(submission.instructor),
        normalizeIdentityPart(submission.course),
        normalizeIdentityPart(submission.section)
    ].join("||");
}

function submissionLabel(submission) {
    return `${submission.instructor} · ${submission.course} · ${submission.section}`;
}

function sameNormalizedValue(a, b) {
    return normalizeIdentityPart(a) === normalizeIdentityPart(b);
}

function examSignature(submission) {
    return submission.exams
        .map(exam => `${exam.examDate}||${normalizeIdentityPart(exam.examName)}`)
        .sort()
        .join("##");
}

function studentNameKey(name) {
    const normalized = normalizeIdentityPart(name);
    return normalized && normalized !== "no student information"
        ? normalized
        : "";
}

function studentMapByName(submission) {
    const map = new Map();

    for (const student of submission.students) {
        const key = studentNameKey(student.studentName);
        if (!key) continue;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(student);
    }

    return map;
}

function customAssignmentForRow(row, assignments = manualCohortAssignments) {
    const assigned = assignments.get(sourceStudentKey(row));
    return assigned && assigned.startsWith("custom||") ? assigned : null;
}

function findIdentityConflict(incoming) {
    const incomingIdentity = submissionIdentity(incoming);

    for (const existing of submissions) {
        if (submissionIdentity(existing) === incomingIdentity) continue;

        // Same source filename is strong evidence that an identifying field
        // changed rather than that a completely new section was submitted.
        if (
            incoming.filename &&
            existing.filename &&
            normalizeIdentityPart(incoming.filename) === normalizeIdentityPart(existing.filename)
        ) {
            return {
                existing,
                reason:
                    `The identifying fields changed relative to the previously loaded file "${existing.filename}".`
            };
        }

        // Same course + section but different instructor.
        if (
            sameNormalizedValue(incoming.course, existing.course) &&
            sameNormalizedValue(incoming.section, existing.section) &&
            !sameNormalizedValue(incoming.instructor, existing.instructor)
        ) {
            return {
                existing,
                reason:
                    "The course and section match an existing record, but the instructor name changed."
            };
        }

        // Same instructor + section but different course.
        if (
            sameNormalizedValue(incoming.instructor, existing.instructor) &&
            sameNormalizedValue(incoming.section, existing.section) &&
            !sameNormalizedValue(incoming.course, existing.course)
        ) {
            return {
                existing,
                reason:
                    "The instructor and section match an existing record, but the course changed."
            };
        }
    }

    return null;
}

function compareStudentChanges(oldSubmission, newSubmission) {
    const oldMap = studentMapByName(oldSubmission);
    const newMap = studentMapByName(newSubmission);

    const oldNames = new Set(oldMap.keys());
    const newNames = new Set(newMap.keys());

    const addedNames = [...newNames].filter(name => !oldNames.has(name));
    const removedNames = [...oldNames].filter(name => !newNames.has(name));

    let multiplierChanges = 0;
    for (const name of [...oldNames].filter(name => newNames.has(name))) {
        const oldStudents = oldMap.get(name);
        const newStudents = newMap.get(name);
        const compareCount = Math.min(oldStudents.length, newStudents.length);

        for (let i = 0; i < compareCount; i += 1) {
            const oldMultiplier = validMultiplier(oldStudents[i].multiplier)
                ? oldStudents[i].multiplier
                : 2;
            const newMultiplier = validMultiplier(newStudents[i].multiplier)
                ? newStudents[i].multiplier
                : 2;

            if (oldMultiplier !== newMultiplier) multiplierChanges += 1;
        }
    }

    // planningTotal captures named students plus placeholders.
    const slotDelta = newSubmission.planningTotal - oldSubmission.planningTotal;

    return {
        addedNames,
        removedNames,
        multiplierChanges,
        slotDelta
    };
}

function rowsForSubmission(detailRows, submission) {
    return detailRows.filter(row =>
        sameNormalizedValue(row.Instructor, submission.instructor) &&
        sameNormalizedValue(row.Course, submission.course) &&
        sameNormalizedValue(row.Section, submission.section)
    );
}

function semanticStudentRowKey(row) {
    const name = studentNameKey(row.Student);
    return [
        row["Exam Date"],
        name || `placeholder-${row._studentSlot}`
    ].join("||");
}

function customPlacementsByExam(oldRows, oldAssignments) {
    const byExam = new Map();

    for (const row of oldRows) {
        const customKey = customAssignmentForRow(row, oldAssignments);
        if (!customKey) continue;

        const date = row["Exam Date"];
        if (!byExam.has(date)) byExam.set(date, new Set());
        byExam.get(date).add(customKey);
    }

    return byExam;
}

function migrateAssignmentsForUpdatedSubmission(
    oldSubmission,
    newSubmission,
    oldDetailedRows,
    oldAssignments,
    summary
) {
    const oldRows = rowsForSubmission(oldDetailedRows, oldSubmission);
    const newRows = rowsForSubmission(detailedRows, newSubmission);

    const oldSemantic = new Map();
    for (const row of oldRows) {
        const customKey = customAssignmentForRow(row, oldAssignments);
        if (!customKey) continue;

        const key = semanticStudentRowKey(row);
        if (!oldSemantic.has(key)) oldSemantic.set(key, []);
        oldSemantic.get(key).push(customKey);
    }

    const placementsByExam = customPlacementsByExam(oldRows, oldAssignments);
    const matchedOldSemantic = new Set();

    for (const row of newRows) {
        const semanticKey = semanticStudentRowKey(row);
        const prior = oldSemantic.get(semanticKey);

        if (prior && prior.length === 1) {
            manualCohortAssignments.set(sourceStudentKey(row), prior[0]);
            matchedOldSemantic.add(semanticKey);
            continue;
        }

        const possibleCustom = placementsByExam.get(row["Exam Date"]) || new Set();

        if (possibleCustom.size === 1) {
            // The section/exam previously lived entirely in one custom cohort,
            // so a newly added student inherits that sub-cohort placement.
            manualCohortAssignments.set(
                sourceStudentKey(row),
                [...possibleCustom][0]
            );
        } else if (possibleCustom.size > 1 && !studentNameKey(row.Student)) {
            summary.review.push(
                `${submissionLabel(newSubmission)} has a new or unresolved student slot on ${row["Exam Date"]}, ` +
                "but that section was split across multiple Custom Cohorts."
            );
        } else if (possibleCustom.size > 1 && !prior) {
            summary.review.push(
                `${submissionLabel(newSubmission)} added or changed student "${row.Student}" on ${row["Exam Date"]}, ` +
                "but that section was split across multiple Custom Cohorts, so the student's placement was not guessed."
            );
        }
    }

    // If a manually placed named student disappeared, surface it.
    const newSemanticKeys = new Set(newRows.map(semanticStudentRowKey));
    for (const row of oldRows) {
        const customKey = customAssignmentForRow(row, oldAssignments);
        if (!customKey || !studentNameKey(row.Student)) continue;

        const key = semanticStudentRowKey(row);
        if (!newSemanticKeys.has(key)) {
            summary.review.push(
                `Manually placed student "${row.Student}" was removed or renamed in ` +
                `${submissionLabel(newSubmission)} for exam date ${row["Exam Date"]}.`
            );
        }
    }
}

function reconcileIncomingSubmissions(incomingSubmissions) {
    const summary = { automatic: [], review: [] };

    for (const incoming of incomingSubmissions) {
        const identity = submissionIdentity(incoming);
        const existingIndex = submissions.findIndex(
            submission => submissionIdentity(submission) === identity
        );

        if (existingIndex === -1) {
            const conflict = findIdentityConflict(incoming);

            if (conflict) {
                summary.review.push(
                    `${submissionLabel(incoming)} was not automatically added. ${conflict.reason} ` +
                    `Existing record: ${submissionLabel(conflict.existing)}.`
                );
                continue;
            }

            submissions.push(incoming);
            const newRows = buildDetailedView([incoming]);
            detailedRows.push(...newRows);
            planningRows = buildPlanningView(detailedRows);

            summary.automatic.push(
                `Added new section ${submissionLabel(incoming)} with ` +
                `${incoming.planningTotal} AES student slot${incoming.planningTotal === 1 ? "" : "s"}.`
            );
            continue;
        }

        const oldSubmission = submissions[existingIndex];
        const oldDetailedRows = detailedRows.map(row => ({ ...row }));
        const oldAssignments = new Map(manualCohortAssignments);
        const oldExamSignature = examSignature(oldSubmission);
        const newExamSignature = examSignature(incoming);
        const studentChanges = compareStudentChanges(oldSubmission, incoming);

        submissions[existingIndex] = incoming;
        detailedRows = buildDetailedView(submissions);
        planningRows = buildPlanningView(detailedRows);

        // Preserve unaffected manual assignments exactly.
        const validNewKeys = new Set(detailedRows.map(sourceStudentKey));
        manualCohortAssignments = new Map(
            [...oldAssignments.entries()].filter(([studentKey]) => validNewKeys.has(studentKey))
        );

        migrateAssignmentsForUpdatedSubmission(
            oldSubmission,
            incoming,
            oldDetailedRows,
            oldAssignments,
            summary
        );

        const updateParts = [];
        if (studentChanges.slotDelta > 0) {
            updateParts.push(`+${studentChanges.slotDelta} AES student slot${studentChanges.slotDelta === 1 ? "" : "s"}`);
        } else if (studentChanges.slotDelta < 0) {
            updateParts.push(`${studentChanges.slotDelta} AES student slots`);
        }

        if (studentChanges.multiplierChanges > 0) {
            updateParts.push(
                `${studentChanges.multiplierChanges} multiplier change${studentChanges.multiplierChanges === 1 ? "" : "s"}`
            );
        }

        summary.automatic.push(
            `Updated ${submissionLabel(incoming)}` +
            (updateParts.length ? ` (${updateParts.join(", ")}).` : ".")
        );

        if (oldExamSignature !== newExamSignature) {
            const oldRows = rowsForSubmission(oldDetailedRows, oldSubmission);
            const affectedCustom = oldRows.some(row => customAssignmentForRow(row, oldAssignments));

            summary.review.push(
                `${submissionLabel(incoming)} changed its exam structure` +
                (affectedCustom
                    ? ", and the section was already represented in a Custom Cohort."
                    : ".")
            );
        }

        // Class-time changes can affect a manually created cohort's timing assumptions.
        if (
            oldSubmission.classStart !== incoming.classStart ||
            oldSubmission.classEnd !== incoming.classEnd
        ) {
            const oldRows = rowsForSubmission(oldDetailedRows, oldSubmission);
            const affectedCustom = oldRows.some(row => customAssignmentForRow(row, oldAssignments));

            if (affectedCustom) {
                summary.review.push(
                    `${submissionLabel(incoming)} changed its regular class start/end time while participating in a Custom Cohort.`
                );
            }
        }
    }

    ensureManualAssignmentsInitialized();
    return summary;
}

function renderUpdateSummary(summary) {
    const automatic = summary?.automatic || [];
    const review = summary?.review || [];

    if (automatic.length === 0 && review.length === 0) {
        updateSummaryPanel.classList.add("hidden");
        updateSummaryPanel.innerHTML = "";
        return;
    }

    updateSummaryPanel.classList.remove("hidden");
    updateSummaryPanel.innerHTML = `
        <div class="update-summary-header">
            <strong>Update Summary</strong>
            <button type="button" class="update-summary-close" aria-label="Close update summary">×</button>
        </div>

        <div class="update-summary-section">
            <div class="update-summary-title">Automatic changes applied</div>
            ${
                automatic.length
                    ? `<ul>${automatic.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
                    : `<div class="update-summary-empty">No automatic changes.</div>`
            }
        </div>

        <div class="update-summary-section ${review.length ? "needs-review" : ""}">
            <div class="update-summary-title">
                Needs Review${review.length ? ` (${review.length})` : ""}
            </div>
            ${
                review.length
                    ? `<ul>${review.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
                    : `<div class="update-summary-empty">Nothing requires review.</div>`
            }
        </div>
    `;

    updateSummaryPanel
        .querySelector(".update-summary-close")
        .addEventListener("click", () => {
            updateSummaryPanel.classList.add("hidden");
        });
}

function normalizeSubmission(data, filename) {
    const section = data.course_section ?? {};
    const exams = Array.isArray(data.exams) ? data.exams : [];
    const students = Array.isArray(data.aes_students) ? data.aes_students : [];
    const summary = data.aes_student_summary ?? {};

    const estimatedTotal = toWholeNumber(summary.estimated_total_students);
    const planningTotal = Math.max(students.length, estimatedTotal ?? students.length);

    if (!section.instructor_name || !section.course || !section.section_number) {
        throw new Error(`"${filename}" is missing instructor, course, or section information.`);
    }

    if (exams.length === 0) {
        throw new Error(`"${filename}" does not contain any exams.`);
    }

    return {
        filename,
        instructor: clean(section.instructor_name),
        course: clean(section.course).toUpperCase(),
        section: clean(section.section_number),
        classStart: clean(section.regular_class_start),
        classEnd: clean(section.regular_class_end),
        exams: exams.map((exam, index) => ({
            examNumber: exam.exam_number ?? index + 1,
            examName: clean(exam.exam_name) || `Exam ${index + 1}`,
            examDate: clean(exam.exam_date)
        })),
        students: students.map((student, index) => ({
            studentNumber: student.student_number ?? index + 1,
            studentName: clean(student.student_name),
            multiplier: Number(student.time_multiplier),
            notes: clean(student.additional_accommodation_information)
        })),
        planningTotal
    };
}

function buildDetailedView(submissionList) {
    const rows = [];

    for (const submission of submissionList) {
        const studentSlots = buildStudentSlots(submission);

        for (const exam of submission.exams) {
            for (const slot of studentSlots) {
                const effectiveMultiplier = validMultiplier(slot.multiplier)
                    ? slot.multiplier
                    : 2;

                const finalOverride = getFinalExamOverride(
                    submission.course,
                    exam.examDate
                );

                const effectiveStart = finalOverride?.start || submission.classStart;
                const effectiveEnd = finalOverride?.end || submission.classEnd;

                rows.push({
                    Instructor: submission.instructor,
                    Course: submission.course,
                    Section: submission.section,
                    Student: slot.studentName,
                    "1.5x or 2x": formatMultiplier(effectiveMultiplier),
                    "Additional Accommodation Information": slot.notes,
                    "Exam Date": exam.examDate,
                    Start: effectiveStart,
                    "AES End": calculateAesEnd(
                        effectiveStart,
                        effectiveEnd,
                        effectiveMultiplier
                    ),
                    _examName: exam.examName,
                    _studentSlot: slot.slotNumber,
                    _isPlaceholder: slot.isPlaceholder,
                    _effectiveMultiplier: effectiveMultiplier,
                    _classEnd: effectiveEnd
                });
            }
        }
    }

    return rows;
}

function buildStudentSlots(submission) {
    const slots = submission.students.map((student, index) => ({
        slotNumber: index + 1,
        studentName: student.studentName || "No student information",
        multiplier: validMultiplier(student.multiplier) ? student.multiplier : null,
        notes: student.notes,
        isPlaceholder: !student.studentName
    }));

    while (slots.length < submission.planningTotal) {
        slots.push({
            slotNumber: slots.length + 1,
            studentName: "No student information",
            multiplier: null,
            notes: "",
            isPlaceholder: true
        });
    }

    return slots;
}

function buildPlanningView(detailRows) {
    const groups = new Map();

    for (const row of detailRows) {
        const key = [
            row.Instructor,
            row.Course,
            row.Section,
            row["Exam Date"],
            row.Start
        ].join("||");

        if (!groups.has(key)) {
            groups.set(key, {
                Instructor: row.Instructor,
                Course: row.Course,
                Section: row.Section,
                "AES Students": new Set(),
                "Exam Date": row["Exam Date"],
                Start: row.Start,
                "AES End Values": []
            });
        }

        const group = groups.get(key);
        group["AES Students"].add(row._studentSlot);

        if (row["AES End"]) {
            group["AES End Values"].push(row["AES End"]);
        }
    }

    return [...groups.values()].map(group => ({
        Instructor: group.Instructor,
        Course: group.Course,
        Section: group.Section,
        "AES Students": group["AES Students"].size,
        "Exam Date": group["Exam Date"],
        Start: group.Start,
        "AES End": latestTime(group["AES End Values"])
    }));
}




function normalizedCourseKey(course) {
    return clean(course).replace(/\s+/g, " ").trim();
}

function isDateWithinFinalsWeek(examDate) {
    if (!examDate || !finalsWeekStart || !finalsWeekEnd) return false;
    return examDate >= finalsWeekStart && examDate <= finalsWeekEnd;
}

function getFinalExamOverride(course, examDate) {
    if (!isDateWithinFinalsWeek(examDate)) return null;

    const entry = finalExamCourseTimes.get(normalizedCourseKey(course));
    if (!entry || !entry.start || !entry.end) return null;

    return entry;
}

function finalsAffectedCoursesForRange(startDate, endDate) {
    if (!startDate || !endDate) return [];

    const courses = new Set();

    for (const submission of submissions) {
        for (const exam of submission.exams) {
            if (exam.examDate >= startDate && exam.examDate <= endDate) {
                courses.add(normalizedCourseKey(submission.course));
            }
        }
    }

    return [...courses].sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
    );
}

function finalsAffectedCourses() {
    return finalsAffectedCoursesForRange(finalsWeekStart, finalsWeekEnd);
}

function finalsConfigurationReviewItems() {
    if (!finalsWeekStart || !finalsWeekEnd) return [];

    const items = [];

    if (finalsWeekEnd < finalsWeekStart) {
        items.push("Final Exam Week end date is earlier than the start date.");
        return items;
    }

    for (const course of finalsAffectedCourses()) {
        const entry = finalExamCourseTimes.get(course);

        if (!entry || !entry.start || !entry.end) {
            items.push(`Final exam time required for ${course}.`);
            continue;
        }

        const start = timeToMinutes(entry.start);
        const end = timeToMinutes(entry.end);

        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
            items.push(`Final exam Start/End is invalid for ${course}.`);
        }
    }

    return items;
}

function renderFinalsSettingsPanel() {
    const affectedCourses = finalsAffectedCoursesForRange(
        finalsDraftWeekStart,
        finalsDraftWeekEnd
    );

    finalsSettingsPanel.innerHTML = `
        <div class="finals-settings-header">
            <strong>Finals Week Settings</strong>
            <button type="button" id="close-finals-settings" class="update-summary-close" aria-label="Close finals settings">×</button>
        </div>

        <div class="finals-week-range">
            <label>
                <span>Final Exam Week Start</span>
                <input id="finals-week-start" type="date" value="${escapeHtml(finalsDraftWeekStart)}">
            </label>
            <label>
                <span>Final Exam Week End</span>
                <input id="finals-week-end" type="date" value="${escapeHtml(finalsDraftWeekEnd)}">
            </label>
        </div>

        <div class="finals-settings-note">
            Courses with exams inside this date range appear below. Enter the university-scheduled
            final Start and End once per course.
        </div>

        ${
            affectedCourses.length
                ? `
                    <div class="finals-course-table-wrap">
                        <table class="finals-course-table">
                            <thead>
                                <tr>
                                    <th>Course</th>
                                    <th>Final Start</th>
                                    <th>Final End</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${affectedCourses.map(course => {
                                    const entry = finalsDraftCourseTimes.get(course) || { start: "", end: "" };
                                    return `
                                        <tr>
                                            <td>${escapeHtml(course)}</td>
                                            <td>
                                                <input
                                                    type="time"
                                                    class="final-course-start"
                                                    data-course="${escapeHtml(course)}"
                                                    value="${escapeHtml(entry.start || "")}"
                                                >
                                            </td>
                                            <td>
                                                <input
                                                    type="time"
                                                    class="final-course-end"
                                                    data-course="${escapeHtml(course)}"
                                                    value="${escapeHtml(entry.end || "")}"
                                                >
                                            </td>
                                        </tr>
                                    `;
                                }).join("")}
                            </tbody>
                        </table>
                    </div>
                `
                : `<div class="finals-settings-empty">No courses currently fall inside the selected Final Exam Week range.</div>`
        }

        <div class="finals-settings-actions">
            <button type="button" id="save-finals-settings" class="cohort-button">
                Save Finals Week Settings
            </button>
            <span id="finals-settings-save-message" class="finals-settings-save-message" aria-live="polite"></span>
        </div>
    `;

    finalsSettingsPanel.querySelector("#close-finals-settings").addEventListener("click", () => {
        finalsSettingsPanel.classList.add("hidden");
    });

    const startInput = finalsSettingsPanel.querySelector("#finals-week-start");
    const endInput = finalsSettingsPanel.querySelector("#finals-week-end");

    const handleRangeChange = () => {
        finalsDraftWeekStart = startInput.value;
        finalsDraftWeekEnd = endInput.value;
        renderFinalsSettingsPanel();
    };

    startInput.addEventListener("change", handleRangeChange);
    endInput.addEventListener("change", handleRangeChange);

    finalsSettingsPanel.querySelectorAll(".final-course-start").forEach(input => {
        input.addEventListener("change", () => {
            const course = input.dataset.course;
            const current = finalsDraftCourseTimes.get(course) || { start: "", end: "" };
            finalsDraftCourseTimes.set(course, { ...current, start: input.value });
        });
    });

    finalsSettingsPanel.querySelectorAll(".final-course-end").forEach(input => {
        input.addEventListener("change", () => {
            const course = input.dataset.course;
            const current = finalsDraftCourseTimes.get(course) || { start: "", end: "" };
            finalsDraftCourseTimes.set(course, { ...current, end: input.value });
        });
    });

    finalsSettingsPanel.querySelector("#save-finals-settings").addEventListener("click", () => {
        finalsWeekStart = finalsDraftWeekStart;
        finalsWeekEnd = finalsDraftWeekEnd;
        finalExamCourseTimes = new Map(finalsDraftCourseTimes);

        rebuildRowsAfterFinalsChange();

        const message = finalsSettingsPanel.querySelector("#finals-settings-save-message");
        if (message) {
            message.textContent = "Settings saved and applied.";
            setTimeout(() => {
                if (message.isConnected) message.textContent = "";
            }, 3000);
        }
    });
}

function rebuildRowsAfterFinalsChange() {
    detailedRows = buildDetailedView(submissions);
    planningRows = buildPlanningView(detailedRows);
    ensureManualAssignmentsInitialized();

    const finalsReview = finalsConfigurationReviewItems();
    lastUpdateSummary = {
        automatic: finalsWeekStart && finalsWeekEnd
            ? ["Applied Final Exam Week scheduling overrides where complete."]
            : [],
        review: finalsReview
    };

    renderUpdateSummary(lastUpdateSummary);
    renderCurrentView();
}

function csvEscape(value) {
    const text = String(value ?? "");
    return `"${text.replace(/"/g, '""')}"`;
}

function exportDisplayValue(column, value) {
    if (value === null || value === undefined || value === "") {
        return "";
    }

    if (column === "Start" || column === "AES End") {
        return formatTime(value);
    }

    return String(value);
}

function downloadCurrentViewCsv() {
    if (!currentDisplayedRows.length || !currentDisplayedColumns.length) {
        return;
    }

    const lines = [
        currentDisplayedColumns.map(csvEscape).join(","),
        ...currentDisplayedRows.map(row =>
            currentDisplayedColumns
                .map(column => csvEscape(exportDisplayValue(column, row[column])))
                .join(",")
        )
    ];

    const csv = "\uFEFF" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const viewName = currentView === "detailed"
        ? "detailed-view"
        : cohortMode
            ? "testing-cohorts"
            : "planning-view";

    const dateStamp = new Date().toISOString().slice(0, 10);
    const link = document.createElement("a");
    link.href = url;
    link.download = `aes-${viewName}-${dateStamp}.csv`;

    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function sourceStudentKey(row) {
    return [
        row.Instructor,
        row.Course,
        row.Section,
        row["Exam Date"],
        row._studentSlot
    ].join("||");
}

function defaultCohortKey(row) {
    const multiplier = row["1.5x or 2x"] || "2x";
    return [
        "default",
        row.Course,
        row["Exam Date"],
        row.Start,
        multiplier
    ].join("||");
}

function getAssignedCohortKey(row) {
    const assigned = manualCohortAssignments.get(sourceStudentKey(row));

    if (
        isDateWithinFinalsWeek(row["Exam Date"]) &&
        assigned &&
        !assigned.startsWith("custom||")
    ) {
        return defaultCohortKey(row);
    }

    return assigned || defaultCohortKey(row);
}

function ensureManualAssignmentsInitialized() {
    for (const row of detailedRows) {
        const studentKey = sourceStudentKey(row);
        const assigned = manualCohortAssignments.get(studentKey);

        if (!assigned) {
            manualCohortAssignments.set(studentKey, defaultCohortKey(row));
            continue;
        }

        if (
            isDateWithinFinalsWeek(row["Exam Date"]) &&
            !assigned.startsWith("custom||")
        ) {
            manualCohortAssignments.set(studentKey, defaultCohortKey(row));
        }
    }
}

function createCustomCohortId() {
    return `custom||${Date.now()}||${Math.random().toString(36).slice(2, 9)}`;
}

function cohortMembersForKey(cohortKey) {
    return detailedRows.filter(row => getAssignedCohortKey(row) === cohortKey);
}

function requiredCustomMultiplier(rows) {
    // Custom cohorts default to 2x unless every member is 1.5x.
    return rows.length > 0 && rows.every(row => row._effectiveMultiplier === 1.5)
        ? 1.5
        : 2;
}

function customCohortEnd(rows, scheduledStart) {
    if (!rows.length) return "";

    const multiplier = requiredCustomMultiplier(rows);
    let maxDuration = 0;

    for (const row of rows) {
        const originalStart = timeToMinutes(row.Start);
        const originalEnd = timeToMinutes(row._classEnd || "");
        if (
            Number.isFinite(originalStart) &&
            Number.isFinite(originalEnd) &&
            originalEnd > originalStart
        ) {
            maxDuration = Math.max(maxDuration, originalEnd - originalStart);
        }
    }

    if (!maxDuration) {
        // Fallback to the latest submitted AES end if class duration is unavailable.
        return latestTime(rows.map(row => row["AES End"]).filter(Boolean));
    }

    const startMinutes = timeToMinutes(scheduledStart);
    if (!Number.isFinite(startMinutes)) return "";

    const aesEnd = startMinutes + maxDuration * multiplier;
    return minutesToTime(Math.ceil(aesEnd / 10) * 10);
}

function serializeCohortPlan() {
    ensureManualAssignmentsInitialized();

    return {
        version: 4,
        saved_at: new Date().toISOString(),
        source_submissions: submissions,
        finals_week: {
            start: finalsWeekStart,
            end: finalsWeekEnd,
            course_times: [...finalExamCourseTimes.entries()]
        },
        manual_assignments: [...manualCohortAssignments.entries()],
        custom_cohorts: [...customCohortMeta.entries()],
        room_size_overrides: [...roomSizeOverrides.entries()]
    };
}

function downloadCohortPlan() {
    const blob = new Blob(
        [JSON.stringify(serializeCohortPlan(), null, 2)],
        { type: "application/json" }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `aes-session-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function loadCohortPlanObject(data) {
    if (!data || ![1, 2, 3, 4].includes(data.version)) {
        throw new Error("This cohort file is not in the expected format.");
    }

    if (!Array.isArray(data.manual_assignments) || !Array.isArray(data.custom_cohorts)) {
        throw new Error("This cohort file is missing required cohort information.");
    }

    if (data.version === 1) {
        if (detailedRows.length === 0) {
            throw new Error(
                "This is an older cohort file that does not contain its source submissions. " +
                "Load the matching Instructor Submission Files first, then load this cohort file."
            );
        }
    } else {
        if (!Array.isArray(data.source_submissions) || data.source_submissions.length === 0) {
            throw new Error("This saved cohort session does not contain source submission data.");
        }

        submissions = data.source_submissions.map((submission, index) => ({
            ...submission,
            filename: submission.filename || `saved-submission-${index + 1}.json`,
            exams: Array.isArray(submission.exams) ? submission.exams : [],
            students: Array.isArray(submission.students) ? submission.students : []
        }));

        if (data.version >= 3 && data.finals_week) {
            finalsWeekStart = data.finals_week.start || "";
            finalsWeekEnd = data.finals_week.end || "";
            finalExamCourseTimes = new Map(
                Array.isArray(data.finals_week.course_times)
                    ? data.finals_week.course_times
                    : []
            );
            finalsDraftWeekStart = finalsWeekStart;
            finalsDraftWeekEnd = finalsWeekEnd;
            finalsDraftCourseTimes = new Map(finalExamCourseTimes);
        } else {
            finalsWeekStart = "";
            finalsWeekEnd = "";
            finalExamCourseTimes = new Map();
            finalsDraftWeekStart = "";
            finalsDraftWeekEnd = "";
            finalsDraftCourseTimes = new Map();
        }

        detailedRows = buildDetailedView(submissions);
        planningRows = buildPlanningView(detailedRows);
    }

    const validStudentKeys = new Set(detailedRows.map(sourceStudentKey));
    const loadedAssignments = new Map();

    for (const [studentKey, cohortKey] of data.manual_assignments) {
        if (validStudentKeys.has(studentKey) && typeof cohortKey === "string") {
            loadedAssignments.set(studentKey, cohortKey);
        }
    }

    manualCohortAssignments = loadedAssignments;
    customCohortMeta = new Map(
        data.custom_cohorts.filter(entry =>
            Array.isArray(entry) &&
            entry.length === 2 &&
            typeof entry[0] === "string" &&
            entry[1] &&
            typeof entry[1] === "object"
        )
    );

    roomSizeOverrides = new Map(
        data.version >= 4 && Array.isArray(data.room_size_overrides)
            ? data.room_size_overrides.filter(entry =>
                Array.isArray(entry) &&
                entry.length === 2 &&
                typeof entry[0] === "string"
            )
            : []
    );

    ensureManualAssignmentsInitialized();
    selectedCohortKeys.clear();
    selectedStudentKeys.clear();
    expandedCohorts.clear();
    manualCohortEditMode = false;

    // Resume directly in the scheduling workspace.
    currentView = "planning";
    cohortMode = true;
    currentSortColumn = "Exam Date";
    currentSortAscending = true;
    searchBox.value = "";
    searchBox.disabled = false;

    detailedViewButton.classList.remove("active");
    planningViewButton.classList.add("active");
    examDateControl.classList.add("hidden");
    cohortControl.classList.remove("hidden");
    planningDateFilter.classList.remove("hidden");

    populateExamDateSelector();
    updateCohortControls();

    lastUpdateSummary = {
        automatic: [
            `Loaded saved cohort workspace with ${submissions.length} section${submissions.length === 1 ? "" : "s"}.`
        ],
        review: finalsConfigurationReviewItems()
    };
    renderUpdateSummary(lastUpdateSummary);

    status.classList.remove("status-error");
    status.textContent =
        `Loaded saved cohort workspace. Add Instructor Submission Files at any time to update or extend it.`;

    renderCurrentView();
}

function resetManualCohorts() {
    manualCohortAssignments.clear();
    customCohortMeta.clear();
    roomSizeOverrides.clear();
    selectedCohortKeys.clear();
    selectedStudentKeys.clear();
    expandedCohorts.clear();
    manualCohortEditMode = false;
    updateCohortControls();
    renderCurrentView();
}


function earliestTime(times) {
    const valid = times
        .map(time => ({ time, minutes: timeToMinutes(time) }))
        .filter(item => Number.isFinite(item.minutes))
        .sort((a, b) => a.minutes - b.minutes);

    return valid.length ? valid[0].time : "";
}

function openCustomCohortTimeDialog({ defaultStart = "", defaultEnd = "" } = {}) {
    return new Promise(resolve => {
        const overlay = document.createElement("div");
        overlay.className = "cohort-time-modal-overlay";

        overlay.innerHTML = `
            <div class="cohort-time-modal" role="dialog" aria-modal="true" aria-labelledby="cohort-time-modal-title">
                <h3 id="cohort-time-modal-title">Set Custom Cohort Time</h3>
                <p>
                    The selected cohorts have different start times. Choose the Start and AES End
                    for the combined Custom Cohort.
                </p>

                <div class="cohort-time-modal-fields">
                    <label>
                        <span>Start</span>
                        <input id="custom-cohort-start" type="time" required value="${escapeHtml(defaultStart)}">
                    </label>
                    <label>
                        <span>AES End</span>
                        <input id="custom-cohort-end" type="time" required value="${escapeHtml(defaultEnd)}">
                    </label>
                </div>

                <div class="cohort-time-modal-error hidden" id="cohort-time-modal-error"></div>

                <div class="cohort-time-modal-actions">
                    <button type="button" class="cohort-button" id="cancel-custom-cohort-time">
                        Cancel
                    </button>
                    <button type="button" class="cohort-button active" id="confirm-custom-cohort-time">
                        Create Custom Cohort
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const startInput = overlay.querySelector("#custom-cohort-start");
        const endInput = overlay.querySelector("#custom-cohort-end");
        const errorBox = overlay.querySelector("#cohort-time-modal-error");

        const close = result => {
            overlay.remove();
            resolve(result);
        };

        overlay.querySelector("#cancel-custom-cohort-time").addEventListener("click", () => close(null));

        overlay.querySelector("#confirm-custom-cohort-time").addEventListener("click", () => {
            const start = startInput.value;
            const end = endInput.value;
            const startMinutes = timeToMinutes(start);
            const endMinutes = timeToMinutes(end);

            if (!start || !end || !Number.isFinite(startMinutes) || !Number.isFinite(endMinutes)) {
                errorBox.textContent = "Enter both a valid Start and AES End time.";
                errorBox.classList.remove("hidden");
                return;
            }

            if (endMinutes <= startMinutes) {
                errorBox.textContent = "AES End must be later than Start.";
                errorBox.classList.remove("hidden");
                return;
            }

            close({ start, end });
        });

        overlay.addEventListener("click", event => {
            if (event.target === overlay) close(null);
        });

        startInput.focus();
    });
}


async function combineSelectedStudentsIntoCustomCohort() {
    const studentKeys = [...selectedStudentKeys];
    if (studentKeys.length < 1) return;

    const members = detailedRows.filter(row =>
        studentKeys.includes(sourceStudentKey(row))
    );

    if (!members.length) return;

    const uniqueExamDates = [...new Set(members.map(row => row["Exam Date"]).filter(Boolean))];
    if (uniqueExamDates.length !== 1) {
        alert(
            "Selected students must belong to the same exam date before they can be placed in one Custom Cohort."
        );
        return;
    }

    const uniqueStarts = [...new Set(members.map(row => row.Start).filter(Boolean))];

    let scheduledStart = members[0].Start;
    let scheduledEnd = "";

    if (uniqueStarts.length > 1) {
        const chosenTimes = await openCustomCohortTimeDialog({
            defaultStart: earliestTime(uniqueStarts),
            defaultEnd: latestTime(members.map(row => row["AES End"]).filter(Boolean))
        });

        if (!chosenTimes) return;

        scheduledStart = chosenTimes.start;
        scheduledEnd = chosenTimes.end;
    }

    const sourceCohortKeys = [...new Set(members.map(getAssignedCohortKey))];
    const newKey = createCustomCohortId();

    customCohortMeta.set(newKey, {
        type: "custom",
        created_from: sourceCohortKeys,
        created_from_students: studentKeys,
        scheduled_start: scheduledStart,
        scheduled_end: scheduledEnd || null,
        exam_date: uniqueExamDates[0]
    });

    for (const row of members) {
        manualCohortAssignments.set(sourceStudentKey(row), newKey);
    }

    selectedStudentKeys.clear();
    selectedCohortKeys.clear();
    expandedCohorts.add(newKey);
    updateCohortControls();
    renderCurrentView();
}

async function combineSelectedCohorts() {
    const cohortKeys = [...selectedCohortKeys];
    if (cohortKeys.length < 2) return;

    const members = detailedRows.filter(row =>
        cohortKeys.includes(getAssignedCohortKey(row))
    );

    if (!members.length) return;

    const selectedCohorts = buildTestingCohorts(detailedRows)
        .filter(cohort => cohortKeys.includes(cohort._cohortKey));

    const uniqueStarts = [...new Set(selectedCohorts.map(cohort => cohort.Start).filter(Boolean))];
    const first = members[0];

    let scheduledStart = first.Start;
    let scheduledEnd = "";

    if (uniqueStarts.length > 1) {
        const chosenTimes = await openCustomCohortTimeDialog({
            defaultStart: earliestTime(uniqueStarts),
            defaultEnd: latestTime(selectedCohorts.map(cohort => cohort["AES End"]).filter(Boolean))
        });

        if (!chosenTimes) return;

        scheduledStart = chosenTimes.start;
        scheduledEnd = chosenTimes.end;
    }

    const newKey = createCustomCohortId();

    customCohortMeta.set(newKey, {
        type: "custom",
        created_from: cohortKeys,
        scheduled_start: scheduledStart,
        scheduled_end: scheduledEnd || null,
        exam_date: first["Exam Date"]
    });

    for (const row of members) {
        manualCohortAssignments.set(sourceStudentKey(row), newKey);
    }

    selectedCohortKeys.clear();
    expandedCohorts.add(newKey);
    updateCohortControls();
    renderCurrentView();
}

function moveStudentToCohort(studentKey, targetCohortKey) {
    const row = detailedRows.find(item => sourceStudentKey(item) === studentKey);
    if (!row || !targetCohortKey) return;

    const currentKey = getAssignedCohortKey(row);
    if (currentKey === targetCohortKey) return;

    // Any manual move creates/maintains a custom target cohort.
    let effectiveTarget = targetCohortKey;

    if (!targetCohortKey.startsWith("custom||")) {
        const targetMembers = cohortMembersForKey(targetCohortKey);
        effectiveTarget = createCustomCohortId();

        const targetFirst = targetMembers[0] || row;
        customCohortMeta.set(effectiveTarget, {
            type: "custom",
            created_from: [targetCohortKey],
            scheduled_start: targetFirst.Start,
            exam_date: targetFirst["Exam Date"]
        });

        for (const member of targetMembers) {
            manualCohortAssignments.set(sourceStudentKey(member), effectiveTarget);
        }
    }

    manualCohortAssignments.set(studentKey, effectiveTarget);
    expandedCohorts.add(effectiveTarget);
    updateCohortControls();
    renderCurrentView();
}


function cohortRoomSize(cohortKey, aesStudents) {
    if (!roomSizeOverrides.has(cohortKey)) {
        return aesStudents;
    }

    return roomSizeOverrides.get(cohortKey);
}

function validRoomSize(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0;
}

function invalidRoomSizeRows(rows) {
    return rows.filter(row => !validRoomSize(row["Room Size"]));
}

function handleExportCurrentView() {
    if (currentView === "planning" && cohortMode && manualCohortEditMode) {
        const invalidRows = invalidRoomSizeRows(currentDisplayedRows);

        if (invalidRows.length) {
            alert(
                "Room Size must be a positive whole number for every displayed cohort before exporting. " +
                "Check any blank, zero, or invalid Room Size entries."
            );
            return;
        }
    }

    downloadCurrentViewCsv();
}

function cohortOptionLabel(cohort) {
    const customLabel = cohort._isCustom ? "Custom Cohort" : "Automatic Cohort";
    return [
        customLabel,
        cohort.Course || "Mixed course",
        cohort["Exam Date"] || "Mixed date",
        cohort.Start ? formatTime(cohort.Start) : "Mixed start",
        `${cohort["AES Students"]} student${cohort["AES Students"] === 1 ? "" : "s"}`
    ].join(" · ");
}

function buildTestingCohorts(detailRows) {
    ensureManualAssignmentsInitialized();

    const groups = new Map();

    for (const row of detailRows) {
        const cohortKey = getAssignedCohortKey(row);
        const isCustom = cohortKey.startsWith("custom||");

        if (!groups.has(cohortKey)) {
            groups.set(cohortKey, {
                _cohortKey: cohortKey,
                _isCustom: isCustom,
                _members: [],
                _contributors: new Map()
            });
        }

        const group = groups.get(cohortKey);
        group._members.push(row);

        const contributorKey = [row.Instructor, row.Section].join("||");
        if (!group._contributors.has(contributorKey)) {
            group._contributors.set(contributorKey, {
                Instructor: row.Instructor,
                Section: row.Section,
                "AES Students": 0
            });
        }
        group._contributors.get(contributorKey)["AES Students"] += 1;
    }

    return [...groups.values()].map(group => {
        const rows = group._members;
        const first = rows[0];

        const uniqueCourses = [...new Set(rows.map(row => row.Course))];
        const uniqueDates = [...new Set(rows.map(row => row["Exam Date"]))];
        const uniqueStarts = [...new Set(rows.map(row => row.Start))];
        const uniqueMultipliers = [...new Set(rows.map(row => row["1.5x or 2x"] || "2x"))];

        let course = uniqueCourses.join(", ");
        let examDate = uniqueDates.length === 1 ? uniqueDates[0] : "Mixed";
        let start = uniqueStarts.length === 1 ? uniqueStarts[0] : first.Start;
        let multiplier = uniqueMultipliers.length === 1 ? uniqueMultipliers[0] : "2x";
        let aesEnd = latestTime(rows.map(row => row["AES End"]).filter(Boolean));

        if (group._isCustom) {
            const meta = customCohortMeta.get(group._cohortKey) || {};
            if (meta.scheduled_start) start = meta.scheduled_start;
            if (meta.exam_date && uniqueDates.length !== 1) examDate = meta.exam_date;

            multiplier = requiredCustomMultiplier(rows) === 1.5 ? "1.5x" : "2x";
            aesEnd = meta.scheduled_end || customCohortEnd(rows, start);
        }

        return {
            _cohortKey: group._cohortKey,
            _isCustom: group._isCustom,
            _members: rows,
            _contributors: [...group._contributors.values()].sort((a, b) =>
                a.Instructor.localeCompare(b.Instructor, undefined, {
                    numeric: true,
                    sensitivity: "base"
                }) ||
                String(a.Section).localeCompare(String(b.Section), undefined, {
                    numeric: true,
                    sensitivity: "base"
                })
            ),
            Type: group._isCustom ? "Custom Cohort" : "Automatic Cohort",
            Instructors: [...new Set(rows.map(row => row.Instructor).filter(Boolean))].join(", "),
            Course: course,
            "Exam Date": examDate,
            Start: start,
            "AES End": aesEnd,
            Multiplier: multiplier,
            "AES Students": rows.length,
            "Room Size": cohortRoomSize(group._cohortKey, rows.length)
        };
    });
}

function buildCohortTable(rows) {
    if (rows.length === 0) {
        return `<div class="no-data">No rows match the current search.</div>`;
    }

    const columns = [
        "Type",
        "Instructors",
        "Course",
        "Exam Date",
        "Start",
        "AES End",
        "Multiplier",
        "AES Students",
        ...(manualCohortEditMode ? ["Room Size"] : [])
    ];
    const cohortOptions = rows.map(cohort => ({
        key: cohort._cohortKey,
        label: cohortOptionLabel(cohort)
    }));

    let html = "";

    if (manualCohortEditMode && invalidRoomSizeRows(rows).length) {
        html += `
            <div class="room-size-warning" role="alert">
                Room Size must be a positive whole number for every cohort before exporting.
                Check any blank, zero, or invalid entries.
            </div>
        `;
    }

    html += `
        <table class="cohort-table">
            <thead>
                <tr>
                    ${manualCohortEditMode ? '<th class="cohort-select-column">Select</th>' : ""}
                    <th class="cohort-expand-column" aria-label="Expand cohort"></th>
                    ${columns.map(column => {
                        let indicator = "";
                        if (currentSortColumn === column) {
                            indicator = currentSortAscending ? " ▲" : " ▼";
                        }

                        return `
                            <th data-column="${escapeHtml(column)}" title="Click to sort">
                                ${escapeHtml(column)}${indicator}
                            </th>
                        `;
                    }).join("")}
                </tr>
            </thead>
            <tbody>
    `;

    for (const row of rows) {
        const expanded = expandedCohorts.has(row._cohortKey);
        const selected = selectedCohortKeys.has(row._cohortKey);

        html += `<tr class="cohort-row ${row._isCustom ? "custom-cohort-row" : ""}">`;

        if (manualCohortEditMode) {
            html += `
                <td class="cohort-select-cell">
                    <input
                        type="checkbox"
                        class="cohort-select-checkbox"
                        data-cohort-key="${escapeHtml(row._cohortKey)}"
                        ${selected ? "checked" : ""}
                        aria-label="Select cohort"
                    >
                </td>
            `;
        }

        html += `
            <td class="cohort-expand-cell">
                <button
                    type="button"
                    class="cohort-expand-button"
                    data-cohort-key="${escapeHtml(row._cohortKey)}"
                    aria-expanded="${expanded}"
                    title="${expanded ? "Hide students" : "Show students"}"
                >${expanded ? "−" : "+"}</button>
            </td>
        `;

        for (const column of columns) {
            if (column === "Room Size" && manualCohortEditMode) {
                const roomSize = row["Room Size"];
                const invalid = !validRoomSize(roomSize);

                html += `
                    <td class="room-size-cell">
                        <input
                            type="number"
                            min="1"
                            step="1"
                            inputmode="numeric"
                            class="room-size-input ${invalid ? "room-size-input-invalid" : ""}"
                            data-cohort-key="${escapeHtml(row._cohortKey)}"
                            value="${escapeHtml(roomSize)}"
                            aria-label="Room size for cohort"
                        >
                    </td>
                `;
                continue;
            }

            const value = formatDisplayValue(column, row[column]);
            const classes = value === "—" ? "empty-cell" : "";
            html += `<td class="${classes}">${escapeHtml(value)}</td>`;
        }

        html += "</tr>";

        if (expanded) {
            const colspan = columns.length + (manualCohortEditMode ? 2 : 1);

            html += `
                <tr class="cohort-detail-row">
                    <td colspan="${colspan}">
                        <div class="cohort-detail">
                            <div class="cohort-detail-heading">Students in this cohort</div>
                            <table class="cohort-contributors">
                                <thead>
                                    <tr>
                                        ${manualCohortEditMode ? '<th class="student-select-column">Select</th>' : ""}
                                        <th>Student</th>
                                        <th>Instructor</th>
                                        <th>Section</th>
                                        <th>Course</th>
                                        <th>Original Start</th>
                                        <th>Multiplier</th>
                                        ${manualCohortEditMode ? "<th>Move to Cohort</th>" : ""}
                                    </tr>
                                </thead>
                                <tbody>
                                    ${row._members.map(member => {
                                        const studentKey = sourceStudentKey(member);
                                        const studentSelected = selectedStudentKeys.has(studentKey);
                                        const accommodationInfo =
                                            member["Additional Accommodation Information"] ||
                                            "No additional accommodation information reported.";
                                        const studentColumnCount = manualCohortEditMode ? 8 : 6;

                                        return `
                                            <tr>
                                                ${manualCohortEditMode ? `
                                                    <td class="student-select-cell">
                                                        <input
                                                            type="checkbox"
                                                            class="student-select-checkbox"
                                                            data-student-key="${escapeHtml(studentKey)}"
                                                            ${studentSelected ? "checked" : ""}
                                                            aria-label="Select ${escapeHtml(member.Student)}"
                                                        >
                                                    </td>
                                                ` : ""}
                                                <td>${escapeHtml(member.Student)}</td>
                                                <td>${escapeHtml(member.Instructor)}</td>
                                                <td>${escapeHtml(member.Section)}</td>
                                                <td>${escapeHtml(member.Course)}</td>
                                                <td>${escapeHtml(formatTime(member.Start))}</td>
                                                <td>${escapeHtml(member["1.5x or 2x"] || "2x")}</td>
                                                ${manualCohortEditMode ? `
                                                    <td>
                                                        <select
                                                            class="move-student-select"
                                                            data-student-key="${escapeHtml(studentKey)}"
                                                        >
                                                            <option value="">Choose cohort…</option>
                                                            ${cohortOptions
                                                                .filter(option => option.key !== row._cohortKey)
                                                                .map(option => `
                                                                    <option value="${escapeHtml(option.key)}">
                                                                        ${escapeHtml(option.label)}
                                                                    </option>
                                                                `).join("")}
                                                        </select>
                                                    </td>
                                                ` : ""}
                                            </tr>
                                            ${
                                                manualCohortEditMode && studentSelected
                                                    ? `
                                                        <tr class="selected-student-accommodation-row">
                                                            <td colspan="${studentColumnCount}">
                                                                <div class="selected-student-accommodation">
                                                                    <strong>Additional Accommodation Information:</strong>
                                                                    <span>${escapeHtml(accommodationInfo)}</span>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    `
                                                    : ""
                                            }
                                        `;
                                    }).join("")}
                                </tbody>
                            </table>
                        </div>
                    </td>
                </tr>
            `;
        }
    }

    html += `
            </tbody>
        </table>
    `;

    return html;
}

function pruneManualSelections() {
    const validStudentKeys = new Set(detailedRows.map(sourceStudentKey));
    selectedStudentKeys = new Set(
        [...selectedStudentKeys].filter(key => validStudentKeys.has(key))
    );

    const validCohortKeys = new Set(
        buildTestingCohorts(detailedRows).map(cohort => cohort._cohortKey)
    );
    selectedCohortKeys = new Set(
        [...selectedCohortKeys].filter(key => validCohortKeys.has(key))
    );
}

function renderCurrentView() {
    if (manualCohortEditMode && cohortMode && detailedRows.length) {
        pruneManualSelections();
    }
    let baseRows;

    if (currentView === "detailed") {
        baseRows = detailedRows;

        if (selectedExamDate && selectedExamDate !== "__ALL__") {
            baseRows = baseRows.filter(row => row["Exam Date"] === selectedExamDate);
        }
    } else if (cohortMode) {
        baseRows = buildTestingCohorts(detailedRows);
    } else {
        baseRows = planningRows;
    }

    if (currentView === "planning") {
        const startDate = planningDateStart.value;
        const endDate = planningDateEnd.value;

        baseRows = baseRows.filter(row => {
            const examDate = row["Exam Date"];
            if (!examDate) return false;
            if (startDate && examDate < startDate) return false;
            if (endDate && examDate > endDate) return false;
            return true;
        });
    }

    if (baseRows.length === 0) {
        currentDisplayedRows = [];
        currentDisplayedColumns = [];
        exportCurrentViewButton.disabled = true;
        tableContainer.innerHTML = `<div class="no-data">No data to display.</div>`;
        return;
    }

    const query = searchBox.value.trim().toLowerCase();

    let rows = baseRows.filter(row => {
        if (!query) return true;

        const visibleMatch = visibleEntries(row).some(([, value]) =>
            String(value ?? "").toLowerCase().includes(query)
        );

        if (visibleMatch) return true;

        if (cohortMode && Array.isArray(row._contributors)) {
            return row._contributors.some(contributor =>
                Object.values(contributor).some(value =>
                    String(value ?? "").toLowerCase().includes(query)
                )
            );
        }

        return false;
    });

    rows = [...rows];

    if (currentSortColumn) {
        rows.sort((a, b) => {
            const comparison = compareValues(
                a[currentSortColumn],
                b[currentSortColumn],
                currentSortColumn
            );
            return currentSortAscending ? comparison : -comparison;
        });
    }

    if (rows.length === 0) {
        currentDisplayedRows = [];
        currentDisplayedColumns = [];
        exportCurrentViewButton.disabled = true;
    }

    if (cohortMode && currentView === "planning") {
        currentDisplayedColumns = manualCohortEditMode
            ? [
                "Instructors",
                "Course",
                "Exam Date",
                "Start",
                "AES End",
                "Room Size"
            ]
            : [
                "Instructors",
                "Course",
                "Exam Date",
                "Start",
                "AES End",
                "AES Students"
            ];
    } else if (rows.length > 0) {
        currentDisplayedColumns = visibleEntries(rows[0]).map(([column]) => column);
    } else {
        currentDisplayedColumns = [];
    }

    currentDisplayedRows = rows;
    exportCurrentViewButton.disabled =
        currentDisplayedRows.length === 0 || currentDisplayedColumns.length === 0;
    exportSessionJsonButton.disabled = submissions.length === 0;

    if (currentView === "planning" && cohortMode) {
        exportCurrentViewButton.textContent = "Export Current View";
        exportCurrentViewButton.title =
            "Downloads the scheduling CSV and a JSON cohort file that can be loaded later.";
    } else {
        exportCurrentViewButton.textContent = "Export Current View";
        exportCurrentViewButton.title = "Downloads the currently displayed rows as CSV.";
    }

    tableContainer.innerHTML = cohortMode && currentView === "planning"
        ? buildCohortTable(rows)
        : buildTable(rows);

    tableContainer.querySelectorAll("th[data-column]").forEach(header => {
        header.addEventListener("click", () => {
            const column = header.dataset.column;

            if (currentSortColumn === column) {
                currentSortAscending = !currentSortAscending;
            } else {
                currentSortColumn = column;
                currentSortAscending = true;
            }

            renderCurrentView();
        });
    });

    tableContainer.querySelectorAll(".cohort-expand-button").forEach(button => {
        button.addEventListener("click", () => {
            const key = button.dataset.cohortKey;

            if (expandedCohorts.has(key)) {
                expandedCohorts.delete(key);
            } else {
                expandedCohorts.add(key);
            }

            renderCurrentView();
        });
    });

    tableContainer.querySelectorAll(".cohort-select-checkbox").forEach(checkbox => {
        checkbox.addEventListener("change", () => {
            const key = checkbox.dataset.cohortKey;
            if (checkbox.checked) {
                selectedCohortKeys.add(key);
            } else {
                selectedCohortKeys.delete(key);
            }
            updateCohortControls();
            renderCurrentView();
        });
    });

    tableContainer.querySelectorAll(".student-select-checkbox").forEach(checkbox => {
        checkbox.addEventListener("change", () => {
            const key = checkbox.dataset.studentKey;

            if (checkbox.checked) {
                selectedStudentKeys.add(key);
            } else {
                selectedStudentKeys.delete(key);
            }

            updateCohortControls();
            renderCurrentView();
        });
    });

    tableContainer.querySelectorAll(".move-student-select").forEach(select => {
        select.addEventListener("change", () => {
            const target = select.value;
            if (!target) return;

            selectedStudentKeys.delete(select.dataset.studentKey);
            moveStudentToCohort(select.dataset.studentKey, target);
        });
    });

    tableContainer.querySelectorAll(".room-size-input").forEach(input => {
        input.addEventListener("change", () => {
            const cohortKey = input.dataset.cohortKey;
            const rawValue = input.value.trim();

            roomSizeOverrides.set(
                cohortKey,
                rawValue === "" ? "" : Number(rawValue)
            );

            renderCurrentView();
        });
    });
}

function buildTable(rows) {
    if (rows.length === 0) {
        return `<div class="no-data">No rows match the current search.</div>`;
    }

    const columns = visibleEntries(rows[0]).map(([key]) => key);

    let html = `
        <table>
            <thead>
                <tr>
                    ${columns.map(column => {
                        let indicator = "";
                        if (currentSortColumn === column) {
                            indicator = currentSortAscending ? " ▲" : " ▼";
                        }

                        return `
                            <th data-column="${escapeHtml(column)}" title="Click to sort">
                                ${escapeHtml(column)}${indicator}
                            </th>
                        `;
                    }).join("")}
                </tr>
            </thead>
            <tbody>
    `;

    for (const row of rows) {
        html += "<tr>";

        for (const column of columns) {
            const value = formatDisplayValue(column, row[column]);
            const classes = [];

            if (column === "Student" && row._isPlaceholder) {
                classes.push("placeholder-student");
            }

            if (value === "—") {
                classes.push("empty-cell");
            }

            html += `<td class="${classes.join(" ")}">${escapeHtml(value)}</td>`;
        }

        html += "</tr>";
    }

    html += `
            </tbody>
        </table>
    `;

    return html;
}

function visibleEntries(row) {
    return Object.entries(row).filter(([key]) => !key.startsWith("_"));
}

function formatDisplayValue(column, value) {
    if (value === null || value === undefined || value === "") {
        return "—";
    }

    if (column === "Exam Date") {
        return formatDate(value);
    }

    if (column === "Start" || column === "AES End") {
        return formatTime(value);
    }

    return String(value);
}

function compareValues(a, b, column) {
    const blankA = a === null || a === undefined || a === "";
    const blankB = b === null || b === undefined || b === "";

    if (blankA && !blankB) return 1;
    if (!blankA && blankB) return -1;
    if (blankA && blankB) return 0;

    if (column === "Exam Date") {
        return String(a).localeCompare(String(b));
    }

    if (column === "Start" || column === "AES End") {
        return timeToMinutes(a) - timeToMinutes(b);
    }

    const numberA = Number(a);
    const numberB = Number(b);
    const bothNumeric = !Number.isNaN(numberA) && !Number.isNaN(numberB);

    if (bothNumeric) {
        return numberA - numberB;
    }

    return String(a).localeCompare(String(b), undefined, {
        numeric: true,
        sensitivity: "base"
    });
}

function calculateAesEnd(classStart, classEnd, multiplier) {
    if (!classStart || !classEnd || !validMultiplier(multiplier)) {
        return "";
    }

    const start = timeToMinutes(classStart);
    const end = timeToMinutes(classEnd);

    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return "";
    }

    const duration = end - start;
    const aesEnd = start + duration * multiplier;
    const roundedAesEnd = Math.ceil(aesEnd / 10) * 10;

    return minutesToTime(roundedAesEnd);
}

function latestTime(values) {
    if (!values || values.length === 0) {
        return "";
    }

    return values.reduce((latest, value) =>
        timeToMinutes(value) > timeToMinutes(latest) ? value : latest
    );
}

function countUniqueStudentSlots(rows) {
    const slots = new Set();

    for (const row of rows) {
        slots.add(`${row.Instructor}||${row.Course}||${row.Section}||${row._studentSlot}`);
    }

    return slots.size;
}

function formatMultiplier(value) {
    return validMultiplier(value) ? `${value}x` : "";
}

function validMultiplier(value) {
    return value === 1.5 || value === 2;
}

function timeToMinutes(value) {
    if (!value || !String(value).includes(":")) {
        return NaN;
    }

    const [hours, minutes] = String(value).split(":").map(Number);
    return hours * 60 + minutes;
}

function minutesToTime(totalMinutes) {
    if (!Number.isFinite(totalMinutes)) {
        return "";
    }

    const rounded = Math.round(totalMinutes);
    const hours = Math.floor(rounded / 60);
    const minutes = rounded % 60;

    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function formatTime(value) {
    if (!value) return "—";

    const [hourText, minute] = String(value).split(":");
    let hour = Number(hourText);

    if (!Number.isFinite(hour)) return String(value);

    const suffix = hour >= 12 ? "PM" : "AM";
    hour = hour % 12 || 12;

    return `${hour}:${minute} ${suffix}`;
}

function formatDate(value) {
    if (!value) return "—";

    const date = new Date(`${value}T00:00:00`);

    if (Number.isNaN(date.getTime())) {
        return String(value);
    }

    return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric"
    });
}

function toWholeNumber(value) {
    const number = Number(value);

    if (!Number.isInteger(number) || number < 0) {
        return null;
    }

    return number;
}

function clean(value) {
    return String(value ?? "").trim();
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}
