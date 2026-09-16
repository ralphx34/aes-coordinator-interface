
importScripts("node_modules/javascript-lp-solver/dist/solver.global.js");

self.onmessage = (event) => {
  const msg = event.data || {};
  if (msg.type !== "solve") return;

  try {
    if (typeof solver === "undefined" || typeof solver.Solve !== "function") {
      throw new Error("Optimization library did not load inside the worker.");
    }

    const problem = normalizeProblem(msg.problem);
    const result = solveMatching(problem);
    self.postMessage({ type: "result", result });
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error && error.message ? error.message : String(error)
    });
  }
};

function trace(message) {
  self.postMessage({ type: "trace", message });
}

function normalizeProblem(raw) {
  const proctors = raw.proctors.map((p, i) => ({
    ...p,
    index: i,
    responses: new Map(Object.entries(p.responses || {}).map(([k,v]) => [Number(k), v]))
  }));

  const cohorts = raw.cohorts.map(c => ({ ...c }));

  const preferred = Array.from({ length: proctors.length }, () => Array(cohorts.length).fill(false));
  const available = Array.from({ length: proctors.length }, () => Array(cohorts.length).fill(false));

  proctors.forEach((p, i) => {
    for (let j = 0; j < cohorts.length; j++) {
      const r = p.responses.get(j);
      preferred[i][j] = r === "Preferred";
      available[i][j] = r === "Available";
    }
  });

  const overlaps = [];
  for (let a = 0; a < cohorts.length; a++) {
    for (let b = a + 1; b < cohorts.length; b++) {
      if (cohortsOverlap(cohorts[a], cohorts[b])) overlaps.push([a, b]);
    }
  }

  return { proctors, cohorts, preferred, available, overlaps };
}

function solveMatching(problem) {
  const P = problem.proctors.length;
  const C = problem.cohorts.length;

  trace(`Loaded ${P} proctors and ${C} cohorts.`);
  trace("Regime 1: solving the Preferred-only coverage problem.");

  let model = buildBaseModel(problem, "preferred-only");
  setObjective(model, "coverage", "max", assignmentVars(model).map(v => [v, 1]));
  let result = solver.Solve(model);
  assertFeasible(result, "Preferred-only coverage");
  const preferredCoverage = Math.round(Number(result.result || 0));

  let stage = null;

  if (preferredCoverage === C) {
    trace(`Preferred-only regime succeeds: all ${C} cohorts can be filled using Preferred assignments only.`);
    trace("Maximizing welfare within the Preferred-only regime.");

    model = buildBaseModel(problem, "preferred-only");
    addPreferredHitIndicators(model, problem);
    addFixedCoverage(model, C);
    setObjective(
      model,
      "welfare",
      "max",
      Array.from({ length: P }, (_, i) => [`z_${i}`, 1])
    );
    result = solver.Solve(model);
    assertFeasible(result, "Preferred-only welfare");
    const welfare = Math.round(Number(result.result || 0));

    trace(`Welfare optimum = ${welfare} distinct proctors receiving at least one Preferred assignment.`);

    stage = {
      regime: "preferred-only",
      coverage: C,
      welfare,
      build: () => {
        const m = buildBaseModel(problem, "preferred-only");
        addPreferredHitIndicators(m, problem);
        addFixedCoverage(m, C);
        addFixedPreferredHitCount(m, P, welfare);
        return m;
      }
    };
  } else {
    trace(`Preferred-only regime cannot fully cover the cohort set: ${preferredCoverage} / ${C}.`);
    trace("Regime 2: expanding feasible edges to Preferred + Available.");
    trace("Maximizing cohort coverage in the expanded regime.");

    model = buildBaseModel(problem, "expanded");
    setObjective(model, "coverage", "max", assignmentVars(model).map(v => [v, 1]));
    result = solver.Solve(model);
    assertFeasible(result, "Expanded coverage");
    const coverage = Math.round(Number(result.result || 0));

    trace(`Expanded-regime maximum coverage = ${coverage} / ${C}.`);
    if (coverage < C) {
      trace(`WARNING: ${C - coverage} cohort${C - coverage === 1 ? "" : "s"} remain unfilled in the best current solution.`);
    }

    trace("Maximizing welfare conditional on maximum coverage.");

    model = buildBaseModel(problem, "expanded");
    addPreferredHitIndicators(model, problem);
    addFixedCoverage(model, coverage);
    setObjective(
      model,
      "welfare",
      "max",
      Array.from({ length: P }, (_, i) => [`z_${i}`, 1])
    );
    result = solver.Solve(model);
    assertFeasible(result, "Expanded welfare");
    const welfare = Math.round(Number(result.result || 0));

    trace(`Welfare optimum = ${welfare} distinct proctors receiving at least one Preferred assignment.`);

    stage = {
      regime: "expanded",
      coverage,
      welfare,
      build: () => {
        const m = buildBaseModel(problem, "expanded");
        addPreferredHitIndicators(m, problem);
        addFixedCoverage(m, coverage);
        addFixedPreferredHitCount(m, P, welfare);
        return m;
      }
    };
  }

  // FAIRNESS 1: derive lower bound analytically, then test feasibility.
  const theoreticalLowerBound = stage.coverage === 0 ? 0 : Math.ceil(stage.coverage / P);
  trace(
    `Fairness refinement 1: theoretical lower bound on maximum workload = ` +
    `ceil(${stage.coverage} / ${P}) = ${theoreticalLowerBound}.`
  );

  let maxWorkload = theoreticalLowerBound;
  let fairnessResult = null;

  while (maxWorkload <= stage.coverage) {
    trace(`Testing whether the welfare-optimal set admits workload <= ${maxWorkload}.`);

    model = stage.build();
    addWorkloadUpperBounds(model, problem, maxWorkload);
    setObjective(model, `fairness_feasibility_${maxWorkload}`, "max", []);
    result = solver.Solve(model);

    if (result && result.feasible !== false) {
      fairnessResult = result;
      trace(`Feasible with maximum workload ${maxWorkload}.`);
      break;
    }

    trace(`Infeasible with maximum workload ${maxWorkload}; increasing the bound.`);
    maxWorkload += 1;
  }

  if (!fairnessResult) {
    throw new Error("Could not find a feasible workload bound.");
  }

  trace(`Minimum possible maximum workload = ${maxWorkload}.`);

  // FAIRNESS 2: infer distance-from-one whenever coverage and welfare force everyone active.
  let distanceFromOne = null;
  let fairness2Result = fairnessResult;

  if (stage.welfare === P && stage.coverage >= P) {
    // Every proctor must receive at least one assignment, so sum |w_i - 1|
    // simplifies to sum (w_i - 1) = coverage - P.
    distanceFromOne = stage.coverage - P;
    trace(
      `Fairness refinement 2 is implied by coverage and welfare: all ${P} proctors receive at least one assignment, ` +
      `so total distance from workload 1 = ${stage.coverage} - ${P} = ${distanceFromOne}.`
    );
  } else {
    trace("Fairness refinement 2: minimizing total distance of workload from 1.");

    model = stage.build();
    addWorkloadUpperBounds(model, problem, maxWorkload);
    addWorkloadVariables(model, problem);
    addDistanceFromOne(model, problem);
    setObjective(
      model,
      "distance_one",
      "min",
      Array.from({ length: P }, (_, i) => [`d_${i}`, 1])
    );
    result = solver.Solve(model);
    assertFeasible(result, "Distance-from-one refinement");
    distanceFromOne = Math.round(Number(result.result || 0));
    fairness2Result = result;

    trace(`Minimum total workload distance from 1 = ${distanceFromOne}.`);
  }

  // FCFS refinement: one exact lexicographic MIP solve instead of one solve per proctor.
  // Proctors are already sorted by Submission Order in the main thread.
  trace("FCFS refinement: applying submission-order priority in one lexicographic solve.");

  if (P > 50) {
    throw new Error(
      `FCFS lexicographic objective currently supports at most 50 proctors; received ${P}.`
    );
  }

  model = stage.build();
  addWorkloadUpperBounds(model, problem, maxWorkload);

  if (!(stage.welfare === P && stage.coverage >= P)) {
    addWorkloadVariables(model, problem);
    addDistanceFromOne(model, problem);
    addFixedDistance(model, P, distanceFromOne);
  }

  // Binary positional weights implement the exact lexicographic order:
  // z_1 dominates every possible combination of later z's, then z_2, etc.
  const fcfsTerms = Array.from({ length: P }, (_, i) => [
    `z_${i}`,
    Math.pow(2, P - i - 1)
  ]);

  setObjective(model, "fcfs_lexicographic", "max", fcfsTerms);
  result = solver.Solve(model);
  assertFeasible(result, "FCFS refinement");

  const allocation = extractAllocation(problem, result);
  const assignmentCounts = countAssignments(allocation, P);

  trace("FCFS lexicographic solve complete. Implied submission-order outcomes:");
  for (let i = 0; i < P; i++) {
    const val = Number(result[`z_${i}`] || 0) >= 0.5 ? 1 : 0;
    let outcome;

    if (assignmentCounts[i] === 0) {
      outcome = "Not assigned in this exam period";
    } else if (val) {
      outcome = "Preferred assignment retained";
    } else {
      outcome = "Assigned, but no Preferred assignment received";
    }

    trace(
      `FCFS ${i + 1}: ${problem.proctors[i].name} (#${problem.proctors[i].submissionOrder}) → ${outcome}.`
    );
  }

  // The FCFS solve itself is already a final representative allocation; no second MIP is needed.
  trace("Final representative allocation obtained from the FCFS solve.");

  trace("Final allocation found.");

  return {
    allocation,
    stats: {
      regime: stage.regime,
      coverage: stage.coverage,
      welfare: stage.welfare,
      maxWorkload,
      distanceFromOne,
      assignmentCounts
    }
  };
}

function addWorkloadUpperBounds(model, problem, cap) {
  const P = problem.proctors.length;
  const C = problem.cohorts.length;

  for (let i = 0; i < P; i++) {
    const c = `workload_cap_${i}`;
    model.constraints[c] = { max: cap };

    for (let j = 0; j < C; j++) {
      const x = xName(i, j);
      if (model.variables[x]) model.variables[x][c] = 1;
    }
  }
}

function addWorkloadVariables(model, problem) {
  const P = problem.proctors.length;
  const C = problem.cohorts.length;

  for (let i = 0; i < P; i++) {
    const w = `w_${i}`;
    ensureVar(model, w);
    model.ints[w] = 1;

    const def = `workload_def_${i}`;
    model.constraints[def] = { equal: 0 };
    model.variables[w][def] = -1;

    for (let j = 0; j < C; j++) {
      const x = xName(i, j);
      if (model.variables[x]) model.variables[x][def] = 1;
    }
  }
}
function buildBaseModel(problem, regime) {
  const P = problem.proctors.length;
  const C = problem.cohorts.length;

  const model = {
    optimize: "__dummy__",
    opType: "max",
    constraints: {},
    variables: {},
    ints: {}
  };

  ensureVar(model, "__dummy_var__");
  model.variables["__dummy_var__"]["__dummy__"] = 0;

  for (let j = 0; j < C; j++) {
    const cname = `cohort_${j}`;
    model.constraints[cname] = { max: 1 };

    for (let i = 0; i < P; i++) {
      const allowed = regime === "preferred-only"
        ? problem.preferred[i][j]
        : (problem.preferred[i][j] || problem.available[i][j]);

      if (!allowed) continue;

      const x = xName(i, j);
      ensureVar(model, x);
      model.ints[x] = 1;
      model.variables[x][cname] = 1;
    }
  }

  for (let i = 0; i < P; i++) {
    for (const [a, b] of problem.overlaps) {
      const xa = xName(i, a);
      const xb = xName(i, b);
      if (!model.variables[xa] || !model.variables[xb]) continue;

      const cname = `overlap_${i}_${a}_${b}`;
      model.constraints[cname] = { max: 1 };
      model.variables[xa][cname] = 1;
      model.variables[xb][cname] = 1;
    }
  }

  return model;
}

function addPreferredHitIndicators(model, problem) {
  const P = problem.proctors.length;
  const C = problem.cohorts.length;

  for (let i = 0; i < P; i++) {
    const z = `z_${i}`;
    ensureVar(model, z);
    model.ints[z] = 1;

    const prefVars = [];
    for (let j = 0; j < C; j++) {
      if (!problem.preferred[i][j]) continue;
      const x = xName(i, j);
      if (model.variables[x]) prefVars.push(x);
    }

    if (!prefVars.length) {
      const c = `z_zero_${i}`;
      model.constraints[c] = { equal: 0 };
      model.variables[z][c] = 1;
      continue;
    }

    const upper = `z_upper_${i}`;
    model.constraints[upper] = { min: 0 };
    for (const x of prefVars) model.variables[x][upper] = 1;
    model.variables[z][upper] = -1;

    prefVars.forEach((x, k) => {
      const lower = `z_lower_${i}_${k}`;
      model.constraints[lower] = { min: 0 };
      model.variables[z][lower] = 1;
      model.variables[x][lower] = -1;
    });
  }
}

function addWorkloadsAndMax(model, problem) {
  const P = problem.proctors.length;
  const C = problem.cohorts.length;

  ensureVar(model, "M");
  model.ints["M"] = 1;

  for (let i = 0; i < P; i++) {
    const w = `w_${i}`;
    ensureVar(model, w);
    model.ints[w] = 1;

    const def = `workload_def_${i}`;
    model.constraints[def] = { equal: 0 };
    model.variables[w][def] = -1;

    for (let j = 0; j < C; j++) {
      const x = xName(i, j);
      if (model.variables[x]) model.variables[x][def] = 1;
    }

    const maxc = `max_workload_${i}`;
    model.constraints[maxc] = { min: 0 };
    model.variables["M"][maxc] = 1;
    model.variables[w][maxc] = -1;
  }
}

function addDistanceFromOne(model, problem) {
  const P = problem.proctors.length;

  for (let i = 0; i < P; i++) {
    const d = `d_${i}`;
    const w = `w_${i}`;
    ensureVar(model, d);

    const c1 = `dist1_${i}`;
    model.constraints[c1] = { min: -1 };
    model.variables[d][c1] = 1;
    model.variables[w][c1] = -1;

    const c2 = `dist2_${i}`;
    model.constraints[c2] = { min: 1 };
    model.variables[d][c2] = 1;
    model.variables[w][c2] = 1;
  }
}

function addFixedCoverage(model, target) {
  const c = "fixed_coverage";
  model.constraints[c] = { equal: target };
  for (const v of assignmentVars(model)) {
    model.variables[v][c] = 1;
  }
}

function addFixedPreferredHitCount(model, P, target) {
  const c = "fixed_welfare";
  model.constraints[c] = { equal: target };
  for (let i = 0; i < P; i++) {
    const z = `z_${i}`;
    ensureVar(model, z);
    model.variables[z][c] = 1;
  }
}

function addFixedMaxWorkload(model, target) {
  const c = "fixed_max_workload";
  model.constraints[c] = { equal: target };
  ensureVar(model, "M");
  model.variables["M"][c] = 1;
}

function addFixedDistance(model, P, target) {
  const c = "fixed_distance";
  model.constraints[c] = { equal: target };
  for (let i = 0; i < P; i++) {
    const d = `d_${i}`;
    ensureVar(model, d);
    model.variables[d][c] = 1;
  }
}

function addFixedFcfs(model, fixed) {
  fixed.forEach(([variable, value], idx) => {
    const c = `fixed_fcfs_${idx}`;
    model.constraints[c] = { equal: value };
    ensureVar(model, variable);
    model.variables[variable][c] = 1;
  });
}

function setObjective(model, name, opType, terms) {
  model.optimize = name;
  model.opType = opType;

  if (!terms.length) {
    ensureVar(model, "__dummy_var__");
    model.variables["__dummy_var__"][name] = 0;
    return;
  }

  for (const [variable, coefficient] of terms) {
    ensureVar(model, variable);
    model.variables[variable][name] = coefficient;
  }
}

function assignmentVars(model) {
  return Object.keys(model.variables).filter(v => /^x_\d+_\d+$/.test(v));
}

function ensureVar(model, name) {
  if (!model.variables[name]) model.variables[name] = {};
}

function xName(i, j) {
  return `x_${i}_${j}`;
}

function extractAllocation(problem, result) {
  const P = problem.proctors.length;
  const C = problem.cohorts.length;
  const allocation = Array(C).fill(-1);

  for (let j = 0; j < C; j++) {
    for (let i = 0; i < P; i++) {
      const x = xName(i, j);
      if ((Number(result[x]) || 0) >= 0.5) {
        allocation[j] = i;
        break;
      }
    }
  }
  return allocation;
}

function countAssignments(allocation, P) {
  const counts = Array(P).fill(0);
  for (const i of allocation) {
    if (i >= 0) counts[i] += 1;
  }
  return counts;
}

function assertFeasible(result, label) {
  if (!result || result.feasible === false) {
    throw new Error(`${label} is infeasible.`);
  }
}

function cohortsOverlap(a, b) {
  const da = normalizeCell(a.date);
  const db = normalizeCell(b.date);
  if (!da || !db || da !== db) return false;

  const aStart = parseTimeToMinutes(a.start);
  const aEnd = parseTimeToMinutes(a.end);
  const bStart = parseTimeToMinutes(b.start);
  const bEnd = parseTimeToMinutes(b.end);

  if ([aStart, aEnd, bStart, bEnd].some(v => v === null)) return false;
  return aStart < bEnd && bStart < aEnd;
}

function normalizeCell(value) {
  return String(value ?? "").trim().toLowerCase();
}

function parseTimeToMinutes(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const twelve = raw.match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/i);
  if (twelve) {
    let hour = Number(twelve[1]);
    const minute = Number(twelve[2]);
    const suffix = twelve[3].toUpperCase();
    if (hour === 12) hour = 0;
    if (suffix === "PM") hour += 12;
    return hour * 60 + minute;
  }

  const twentyFour = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (twentyFour) {
    return Number(twentyFour[1]) * 60 + Number(twentyFour[2]);
  }

  return null;
}
