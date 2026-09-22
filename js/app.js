import {GAS_PROPERTIES} from "./gas-properties.js";
import {calculateGasState, calculateRequiredGasAddition} from "./calculations.js";
import {
  summarizeInputValidation,
  fitCalibrationsFromTable,
  makeCalibrationFitTable,
  processMeasurementTable,
  applySamplingCorrections,
  makeCompactResultsTable,
  makeWideResultsTable
} from "./batch-processing.js";
import {
  readInputTable,
  makeOutputWorkbook,
  makeDelimitedBlob,
  workbookToBlob,
  downloadBlob
} from "./excel-io.js";
import {
  initializeAnalytics,
  trackAnalyticsEvent,
  setupTrackedLinks,
  getGlobalCalculationCount
} from "./analytics.js";


function systemPrefersDark() {
  return window.matchMedia &&
         window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolvedTheme(choice) {
  if (choice === "system") {
    return systemPrefersDark() ? "dark" : "light";
  }
  return choice;
}

function applyTheme(choice) {
  const validChoice = ["light", "dark", "system"].includes(choice) ? choice : "system";
  const actualTheme = resolvedTheme(validChoice);

  document.documentElement.dataset.theme = actualTheme;
  localStorage.setItem("egasboard_theme", validChoice);

  document.querySelectorAll(".theme-button").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.themeChoice === validChoice
    );
  });

  if (batchPayload) {
    renderSelectedPlot();
  }
}

function setupTheme() {
  const savedTheme = localStorage.getItem("egasboard_theme") || "system";
  applyTheme(savedTheme);

  document.querySelectorAll(".theme-button").forEach(button => {
    button.addEventListener("click", () => {
      applyTheme(button.dataset.themeChoice);
    });
  });

  if (window.matchMedia) {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    mediaQuery.addEventListener("change", () => {
      const currentChoice = localStorage.getItem("egasboard_theme") || "system";
      if (currentChoice === "system") {
        applyTheme("system");
      }
    });
  }
}

function cssVariable(name) {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}



let metadata = null;
let batchPayload = null;

function byId(id) {
  return document.getElementById(id);
}

function numberValue(id) {
  return Number(byId(id).value);
}

function optionalNumber(id) {
  const raw = byId(id).value.trim();
  return raw === "" ? null : Number(raw);
}

function recordUsage() {
  const key = "egasboard_usage_count";
  const current = Number(localStorage.getItem(key) || "0");
  const next = current + 1;
  localStorage.setItem(key, String(next));
  refreshMetricsDisplay();
}

function recordGasCalculations(numberOfCalculations) {
  const increment = Math.max(
    0,
    Math.floor(Number(numberOfCalculations) || 0)
  );

  if (increment === 0) {
    return;
  }

  const key = "egasboard_gas_calculation_count";
  const current = Number(localStorage.getItem(key) || "0");
  const next = current + increment;
  localStorage.setItem(key, String(next));
  refreshMetricsDisplay();
}

function refreshMetricsDisplay() {
  const usageCounter = byId("usage-counter");
  if (usageCounter) {
    usageCounter.textContent =
      localStorage.getItem("egasboard_usage_count") || "0";
  }

  const gasCounter = byId("gas-calculation-counter");
  if (gasCounter) {
    gasCounter.textContent =
      localStorage.getItem("egasboard_gas_calculation_count") || "0";
  }
}

async function refreshGlobalCalculationCount() {
  const counter = byId("global-calculation-counter");

  if (!counter) {
    return;
  }

  const total = await getGlobalCalculationCount();
  counter.textContent = total.toLocaleString();
}

function showStatus(element, type, html) {
  element.className = "status " + type;
  element.innerHTML = html;
}

function clearStatus(element) {
  element.className = "status hidden";
  element.textContent = "";
}

function staticMetadata() {
  return {
    software_name: "(E)Gasboard",
    software_version: "v0.1",
    calculation_method_version: "v0.1",
    author: "Reinier A. Egas",
    year: 2026,
    doi: null,
    gases: Object.values(GAS_PROPERTIES).map(gas => ({
      gas_id: gas.gas_id,
      gas_name: gas.gas_name
    }))
  };
}

function populateGasSelect(select, preferred) {
  select.innerHTML = "";

  metadata.gases.forEach(gas => {
    const option = document.createElement("option");
    option.value = gas.gas_id;
    option.textContent = gas.gas_id + " - " + gas.gas_name;
    if (gas.gas_id === preferred) option.selected = true;
    select.appendChild(option);
  });
}

function metric(label, value) {
  return `
    <div class="metric">
      <span class="metric-label">${label}</span>
      <strong>${value}</strong>
    </div>
  `;
}

function formatNumber(value, digits = 5) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return Number(value).toFixed(digits);
}

function setupTabs() {
  document.querySelectorAll(".tab-button").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".tab-button").forEach(item => item.classList.remove("active"));
      document.querySelectorAll(".tab-panel").forEach(item => item.classList.remove("active"));

      button.classList.add("active");
      byId("tab-" + button.dataset.tab).classList.add("active");
    });
  });
}

async function calculateSingle() {
  const status = byId("single-status");
  clearStatus(status);

  const payload = {
    gas_id: byId("single-gas").value,
    gas_percent: numberValue("single-percent"),
    pressure_bar_abs: numberValue("single-pressure"),
    temperature_c: numberValue("single-temperature"),
    bottle_volume_ml: numberValue("single-bottle"),
    liquid_volume_ml: numberValue("single-liquid"),
    salinity_g_l_nacl: numberValue("single-salinity"),
    ph: optionalNumber("single-ph"),
    compressibility_factor: 1.0
  };

  try {
    const result = calculateGasState(payload);
    recordUsage();
    recordGasCalculations(1);
    trackAnalyticsEvent(
      "single-calculation",
      "Single gas calculation"
    );

    let html = "";
    html += metric("Total bottle", formatNumber(result.total_bottle_mmol, 6) + " mmol");
    html += metric("Headspace", formatNumber(result.headspace_mmol, 6) + " mmol");
    html += metric("Molecular dissolved", formatNumber(result.molecular_dissolved_mmol, 6) + " mmol");
    html += metric("Partial pressure", formatNumber(result.partial_pressure_Pa / 100000, 4) + " bar");

    if (result.estimated_DIC_mmol !== undefined && result.estimated_DIC_mmol !== null) {
      html += metric("Estimated dissolved inorganic carbon (DIC)", formatNumber(result.estimated_DIC_mmol, 6) + " mmol");
    }
    if (result.estimated_total_sulfide_mmol !== undefined && result.estimated_total_sulfide_mmol !== null) {
      html += metric("Estimated dissolved total sulfide", formatNumber(result.estimated_total_sulfide_mmol, 6) + " mmol");
    }

    byId("single-results").innerHTML = html;

    if (result.warnings && result.warnings.length) {
      showStatus(status, "warning", result.warnings.join("<br>"));
    } else {
      showStatus(status, "good", "All good!");
    }
  } catch (error) {
    showStatus(status, "error", error.message);
  }
}

async function calculateDose() {
  const status = byId("dose-status");
  clearStatus(status);

  const payload = {
    gas_id: byId("dose-gas").value,
    target_dissolved_umol_l: numberValue("dose-target"),
    target_basis: byId("dose-target-basis").value,
    bottle_volume_ml: numberValue("dose-bottle"),
    liquid_volume_ml: numberValue("dose-liquid"),
    temperature_c: numberValue("dose-temperature"),
    salinity_g_l_nacl: numberValue("dose-salinity"),
    ph: optionalNumber("dose-ph"),
    initial_gas_percent: numberValue("dose-initial-percent"),
    initial_pressure_bar_abs: numberValue("dose-initial-pressure"),
    dose_gas_percent: numberValue("dose-gas-percent"),
    dose_pressure_bar_abs: numberValue("dose-pressure"),
    compressibility_factor: 1.0
  };

  try {
    const result = calculateRequiredGasAddition(payload);
    recordUsage();
    recordGasCalculations(1);
    trackAnalyticsEvent(
      "gas-dosing",
      "Gas dosing calculation"
    );

    const targetLabel = result.target_basis === "total_pool"
      ? (result.gas_id === "CO2" ? "Target dissolved inorganic carbon (DIC)" : "Target dissolved total sulfide")
      : "Target molecular dissolved";

    byId("dose-results").innerHTML =
      metric("Gas to add", formatNumber(result.required_target_gas_mmol, 6) + " mmol") +
      metric("Dosing mixture", formatNumber(result.required_dose_mix_volume_mL, 3) + " mL") +
      metric("Target headspace", formatNumber(result.target_headspace_mmol, 6) + " mmol") +
      metric(targetLabel, formatNumber(result.target_dissolved_mmol, 6) + " mmol") +
      metric("Required partial pressure", formatNumber(result.required_partial_pressure_bar, 4) + " bar");

    if (result.warnings && result.warnings.length) {
      showStatus(status, "warning", result.warnings.join("<br>"));
    } else {
      showStatus(status, "good", "All good!");
    }
  } catch (error) {
    showStatus(status, "error", error.message);
  }
}

async function calculateBatch() {
  const status = byId("batch-status");
  clearStatus(status);

  const measurementFile = byId("measurement-file").files[0];
  const calibrationFile = byId("calibration-file").files[0];

  if (!measurementFile || !calibrationFile) {
    showStatus(status, "error", "Choose both a measurement file and a calibration file.");
    return;
  }

  showStatus(status, "warning", "Calculating locally in your browser...");

  try {
    const measurementRows = await readInputTable(measurementFile);
    const calibrationRows = await readInputTable(calibrationFile);

    const inputQc = summarizeInputValidation(calibrationRows, measurementRows);
    const errors = inputQc.filter(item => item[0] === "ERROR").map(item => item[1]);
    if (errors.length) {
      showStatus(status, "error", errors.join("<br>"));
      return;
    }

    const fit = fitCalibrationsFromTable(calibrationRows);
    let results = processMeasurementTable(measurementRows, fit.calibrations, 1.0);
    results = applySamplingCorrections(results, measurementRows);
    const compactResults = makeCompactResultsTable(results);
    const wideResults = makeWideResultsTable(results);

    const calibrationFits = {};
    for (const [gasId, model] of Object.entries(fit.calibrations)) {
      calibrationFits[gasId] = makeCalibrationFitTable(calibrationRows, gasId, model);
    }

    batchPayload = {
      ok: true,
      input_qc: inputQc,
      calibration_summary: fit.calibration_summary,
      calibration_fits: calibrationFits,
      calibrations: fit.calibrations,
      calibration_rows: calibrationRows,
      results,
      results_compact: compactResults,
      results_wide: wideResults,
      output_basename: "EGasboard_results_v0.1"
    };

    recordUsage();

    if (inputQc.length === 0) {
      showStatus(status, "good", "All good!");
    } else {
      showStatus(status, "warning", inputQc.map(item => item[1]).join("<br>"));
    }

    byId("batch-results").classList.remove("hidden");

    const validRows = results.filter(row => !row.processing_error);
    const experiments = [...new Set(validRows.map(row => row.experiment_id))];

    recordGasCalculations(validRows.length);
    trackAnalyticsEvent(
      "batch-calculation",
      "Batch calculation - " + validRows.length + " gas observations"
    );

    byId("batch-summary").innerHTML =
      metric("Calculated gas observations", String(validRows.length)) +
      metric("Experiments", String(experiments.length)) +
      metric("Calibration curves", String(fit.calibration_summary.length)) +
      metric("QC rows flagged", String(validRows.filter(row => row.QC_status && row.QC_status !== "OK").length));

    populateCalibrationPlotSelector();
    populatePlotSelectors();
    renderResultsTable(compactResults.length ? compactResults : wideResults);
    renderCalibrationPlot();
    renderSelectedPlot();
  } catch (error) {
    showStatus(status, "error", error.message);
  }
}

function populateSelect(select, values) {
  select.innerHTML = "";
  values.forEach(value => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
}

function populateCalibrationPlotSelector() {
  if (!batchPayload || !batchPayload.calibration_summary) return;

  const gases = batchPayload.calibration_summary.map(row => String(row.gas_id));
  populateSelect(byId("calibration-plot-gas"), gases);
}

function renderCalibrationPlot() {
  if (!batchPayload) return;

  const selector = byId("calibration-plot-gas");
  if (!selector || !selector.value) return;

  const gas = selector.value;
  const fitRows = (batchPayload.calibration_fits || {})[gas] || [];
  const summary = (batchPayload.calibration_summary || []).find(
    row => String(row.gas_id) === gas
  );

  if (!fitRows.length || !summary) return;

  const xValues = fitRows.map(row => Number(row.gas_percent));
  const measured = fitRows.map(row => Number(row.peak_area));
  const fitted = fitRows.map(row => Number(row.fitted_peak_area));

  let equation = `A = ${Number(summary.slope_area_per_percent).toPrecision(5)}x`;
  const intercept = Number(summary.intercept_area);

  if (Math.abs(intercept) > 1e-12) {
    equation += intercept >= 0
      ? ` + ${intercept.toPrecision(4)}`
      : ` - ${Math.abs(intercept).toPrecision(4)}`;
  }

  if (summary.r_squared !== null && summary.r_squared !== undefined) {
    equation += `; R² = ${Number(summary.r_squared).toFixed(4)}`;
  }

  byId("calibration-chart-title").textContent = `${gas} calibration curve - ${equation}`;

  drawCalibrationChart(
    byId("calibration-chart"),
    xValues,
    measured,
    fitted
  );
}

function drawCalibrationChart(svg, xValues, measuredValues, fittedValues) {
  const width = 900;
  const height = 430;
  const left = 82;
  const right = 24;
  const top = 24;
  const bottom = 62;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;

  svg.innerHTML = "";
  if (!xValues.length) return;

  const xMin = 0;
  const xMaxRaw = Math.max(...xValues);
  const xMax = xMaxRaw <= 0 ? 1 : xMaxRaw * 1.05;

  const yMaxRaw = Math.max(...measuredValues, ...fittedValues, 0);
  const yMin = 0;
  const yMax = yMaxRaw <= 0 ? 1 : yMaxRaw * 1.08;

  const xScale = x => left + ((x - xMin) / (xMax - xMin)) * plotWidth;
  const yScale = y => top + plotHeight - ((y - yMin) / (yMax - yMin)) * plotHeight;

  function add(tag, attrs, text) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.entries(attrs || {}).forEach(([key, value]) => element.setAttribute(key, value));
    if (text !== undefined) element.textContent = text;
    svg.appendChild(element);
    return element;
  }

  for (let i = 0; i <= 5; i++) {
    const fraction = i / 5;

    const x = left + fraction * plotWidth;
    const xv = xMin + fraction * (xMax - xMin);
    add("line", {
      x1:x, y1:top, x2:x, y2:top+plotHeight,
      stroke:cssVariable("--chart-grid"), "stroke-width":"1"
    });
    add("text", {
      x:x, y:top+plotHeight+24, "text-anchor":"middle",
      fill:cssVariable("--muted"), "font-size":"12"
    }, xv.toFixed(2));

    const y = top + plotHeight - fraction * plotHeight;
    const yv = yMin + fraction * (yMax - yMin);
    add("line", {
      x1:left, y1:y, x2:left+plotWidth, y2:y,
      stroke:cssVariable("--chart-grid"), "stroke-width":"1"
    });
    add("text", {
      x:left-10, y:y+4, "text-anchor":"end",
      fill:cssVariable("--muted"), "font-size":"12"
    }, yv.toFixed(1));
  }

  add("line", {
    x1:left, y1:top+plotHeight, x2:left+plotWidth, y2:top+plotHeight,
    stroke:cssVariable("--chart-axis"), "stroke-width":"1.6"
  });
  add("line", {
    x1:left, y1:top, x2:left, y2:top+plotHeight,
    stroke:cssVariable("--chart-axis"), "stroke-width":"1.6"
  });

  add("text", {
    x:left + plotWidth/2, y:height-16, "text-anchor":"middle",
    fill:cssVariable("--text"), "font-size":"13"
  }, "Gas concentration (%)");

  const yText = add("text", {
    x:18, y:top + plotHeight/2, "text-anchor":"middle",
    fill:cssVariable("--text"), "font-size":"13"
  }, "Peak area");
  yText.setAttribute("transform", `rotate(-90 18 ${top + plotHeight/2})`);

  const sorted = xValues.map((x, i) => ({x, y:fittedValues[i]}))
    .sort((a, b) => a.x - b.x);

  add("polyline", {
    points: sorted.map(p => `${xScale(p.x)},${yScale(p.y)}`).join(" "),
    fill: "none",
    stroke: cssVariable("--accent"),
    "stroke-width": "2.4",
    "stroke-linecap": "round"
  });

  xValues.forEach((x, i) => {
    const point = add("circle", {
      cx:xScale(x),
      cy:yScale(measuredValues[i]),
      r:5,
      fill:cssVariable("--text")
    });

    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = `Gas %: ${x}; peak area: ${measuredValues[i]}`;
    point.appendChild(title);
  });
}

function populatePlotSelectors() {
  const rows = batchPayload.results.filter(row => !row.processing_error);

  const samplingOption = byId("plot-metric").querySelector(
    'option[value="sampling_corrected_total_mmol"]'
  );
  const hasSamplingCorrectedResults = rows.some(row =>
    row.sampling_corrected_total_mmol !== null &&
    row.sampling_corrected_total_mmol !== undefined &&
    row.sampling_corrected_total_mmol !== "" &&
    Number.isFinite(Number(row.sampling_corrected_total_mmol))
  );

  if (samplingOption) {
    samplingOption.disabled = !hasSamplingCorrectedResults;
  }

  if (!hasSamplingCorrectedResults &&
      byId("plot-metric").value === "sampling_corrected_total_mmol") {
    byId("plot-metric").value = "total_bottle_mmol";
  }

  const experiments = [...new Set(rows.map(row => String(row.experiment_id)))];
  populateSelect(byId("plot-experiment"), experiments);
  refreshSamples();
}

function refreshSamples() {
  const experiment = byId("plot-experiment").value;
  const rows = batchPayload.results.filter(
    row => !row.processing_error && String(row.experiment_id) === experiment
  );
  const samples = [...new Set(rows.map(row => String(row.sample_id)))];
  populateSelect(byId("plot-sample"), samples);
  refreshGases();
}

function refreshGases() {
  const experiment = byId("plot-experiment").value;
  const sample = byId("plot-sample").value;
  const rows = batchPayload.results.filter(
    row => !row.processing_error &&
           String(row.experiment_id) === experiment &&
           String(row.sample_id) === sample
  );
  const gases = [...new Set(rows.map(row => String(row.gas_id)))];
  populateSelect(byId("plot-gas"), gases);
  updatePlotMode();
}

function updatePlotMode() {
  const allMode = byId("plot-mode").value === "all";
  byId("plot-gas-label").style.display = allMode ? "none" : "flex";
  renderSelectedPlot();
}

function selectedMetricDefinition() {
  const metric = byId("plot-metric").value;

  const definitions = {
    total_bottle_mmol: {label: "Total bottle amount", axis: "Gas amount (mmol)"},
    sampling_corrected_total_mmol: {label: "Sampling-corrected total amount", axis: "Gas amount (mmol)"},
    headspace_mmol: {label: "Headspace amount", axis: "Gas amount (mmol)"},
    molecular_dissolved_mmol: {label: "Molecular dissolved amount", axis: "Gas amount (mmol)"},
    gas_percent: {label: "Gas concentration", axis: "Gas concentration (%)"},
    partial_pressure_bar: {label: "Partial pressure", axis: "Partial pressure (bar)"}
  };

  return definitions[metric];
}

function metricValue(row, metric) {
  if (metric === "partial_pressure_bar") {
    if (row.partial_pressure_Pa === null ||
        row.partial_pressure_Pa === undefined ||
        row.partial_pressure_Pa === "") {
      return NaN;
    }
    return Number(row.partial_pressure_Pa) / 100000.0;
  }

  if (row[metric] === null ||
      row[metric] === undefined ||
      row[metric] === "") {
    return NaN;
  }

  return Number(row[metric]);
}

function renderSelectedPlot() {
  if (!batchPayload) return;

  const experiment = byId("plot-experiment").value;
  const sample = byId("plot-sample").value;
  const mode = byId("plot-mode").value;
  const metric = byId("plot-metric").value;
  const metricDefinition = selectedMetricDefinition();

  const sampleRows = batchPayload.results
    .filter(row =>
      !row.processing_error &&
      String(row.experiment_id) === experiment &&
      String(row.sample_id) === sample
    );

  if (mode === "all") {
    const gases = [...new Set(sampleRows.map(row => String(row.gas_id)))];

    const series = gases.map(gas => {
      const points = sampleRows
        .filter(row => String(row.gas_id) === gas)
        .sort((a, b) => Number(a.time_h) - Number(b.time_h))
        .map(row => ({
          x: Number(row.time_h),
          y: metricValue(row, metric)
        }))
        .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));

      return {
        label: gas,
        xValues: points.map(point => point.x),
        yValues: points.map(point => point.y)
      };
    });

    byId("chart-title").textContent =
      `${metricDefinition.label} - all gases - ${sample}`;

    drawMultiLineChart(
      byId("result-chart"),
      series,
      "Time (h)",
      metricDefinition.axis
    );
  } else {
    const gas = byId("plot-gas").value;
    const points = sampleRows
      .filter(row => String(row.gas_id) === gas)
      .sort((a, b) => Number(a.time_h) - Number(b.time_h))
      .map(row => ({
        x: Number(row.time_h),
        y: metricValue(row, metric)
      }))
      .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));

    byId("chart-title").textContent =
      `${gas} ${metricDefinition.label.toLowerCase()} - ${sample}`;

    drawLineChart(
      byId("result-chart"),
      points.map(point => point.x),
      points.map(point => point.y),
      "Time (h)",
      metricDefinition.axis
    );
  }
}

function drawMultiLineChart(svg, series, xLabel, yLabel) {
  const width = 900;
  const height = 430;
  const left = 82;
  const right = 24;
  const top = 24;
  const bottom = 72;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;

  svg.innerHTML = "";

  const usableSeries = series.filter(item => item.xValues.length > 0);
  if (!usableSeries.length) return;

  const allX = usableSeries.flatMap(item => item.xValues);
  const allY = usableSeries.flatMap(item => item.yValues).filter(Number.isFinite);

  const xMin = Math.min(0, ...allX);
  const xMaxRaw = Math.max(...allX);
  const xMax = xMaxRaw === xMin ? xMin + 1 : xMaxRaw;

  const yMinRaw = Math.min(...allY);
  const yMaxRaw = Math.max(...allY);
  const yMin = yMinRaw >= 0 ? 0 : yMinRaw;
  const yMax = yMaxRaw === yMin ? yMin + 1 : yMaxRaw * 1.08;

  const xScale = x => left + ((x - xMin) / (xMax - xMin)) * plotWidth;
  const yScale = y => top + plotHeight - ((y - yMin) / (yMax - yMin)) * plotHeight;

  const palette = [
    "#245f3d", "#7b1e2b", "#4169a1", "#8a6d1f", "#76518e",
    "#2f7f7f", "#9a4f2a", "#5f6f3a", "#4c6f91"
  ];

  function add(tag, attrs, text) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.entries(attrs || {}).forEach(([key, value]) => element.setAttribute(key, value));
    if (text !== undefined) element.textContent = text;
    svg.appendChild(element);
    return element;
  }

  for (let i = 0; i <= 5; i++) {
    const fraction = i / 5;

    const x = left + fraction * plotWidth;
    const xValue = xMin + fraction * (xMax - xMin);
    add("line", {
      x1:x, y1:top, x2:x, y2:top+plotHeight,
      stroke:cssVariable("--chart-grid"), "stroke-width":"1"
    });
    add("text", {
      x:x, y:top+plotHeight+24, "text-anchor":"middle",
      fill:cssVariable("--muted"), "font-size":"12"
    }, xValue.toFixed(1));

    const y = top + plotHeight - fraction * plotHeight;
    const yValue = yMin + fraction * (yMax - yMin);
    add("line", {
      x1:left, y1:y, x2:left+plotWidth, y2:y,
      stroke:cssVariable("--chart-grid"), "stroke-width":"1"
    });
    add("text", {
      x:left-10, y:y+4, "text-anchor":"end",
      fill:cssVariable("--muted"), "font-size":"12"
    }, yValue.toFixed(3));
  }

  add("text", {
    x:left + plotWidth/2, y:height-18, "text-anchor":"middle",
    fill:cssVariable("--text"), "font-size":"13"
  }, xLabel);

  const yText = add("text", {
    x:18, y:top + plotHeight/2, "text-anchor":"middle",
    fill:cssVariable("--text"), "font-size":"13"
  }, yLabel);
  yText.setAttribute("transform", `rotate(-90 18 ${top + plotHeight/2})`);

  usableSeries.forEach((item, seriesIndex) => {
    const color = palette[seriesIndex % palette.length];

    const points = item.xValues
      .map((x, index) => `${xScale(x)},${yScale(item.yValues[index])}`)
      .join(" ");

    add("polyline", {
      points,
      fill: "none",
      stroke: color,
      "stroke-width": "2.4",
      "stroke-linejoin": "round",
      "stroke-linecap": "round"
    });

    item.xValues.forEach((x, index) => {
      const circle = add("circle", {
        cx:xScale(x),
        cy:yScale(item.yValues[index]),
        r:4,
        fill:color
      });

      const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
      title.textContent =
        `${item.label}; ${xLabel}: ${x}; ${yLabel}: ${item.yValues[index].toFixed(6)}`;
      circle.appendChild(title);
    });

    const legendX = left + seriesIndex * 92;
    const legendY = height - 44;
    add("line", {
      x1:legendX, y1:legendY, x2:legendX+18, y2:legendY,
      stroke:color, "stroke-width":"3"
    });
    add("text", {
      x:legendX+24, y:legendY+4,
      fill:cssVariable("--text"), "font-size":"12"
    }, item.label);
  });
}

function drawLineChart(svg, xValues, yValues, xLabel, yLabel) {
  const width = 900;
  const height = 430;
  const left = 82;
  const right = 24;
  const top = 24;
  const bottom = 62;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;

  svg.innerHTML = "";

  if (!xValues.length) return;

  const xMin = Math.min(0, ...xValues);
  const xMaxRaw = Math.max(...xValues);
  const xMax = xMaxRaw === xMin ? xMin + 1 : xMaxRaw;

  const yMinRaw = Math.min(...yValues);
  const yMaxRaw = Math.max(...yValues);
  const yMin = yMinRaw >= 0 ? 0 : yMinRaw;
  const yMax = yMaxRaw === yMin ? yMin + 1 : yMaxRaw * 1.08;

  const xScale = x => left + ((x - xMin) / (xMax - xMin)) * plotWidth;
  const yScale = y => top + plotHeight - ((y - yMin) / (yMax - yMin)) * plotHeight;

  function add(tag, attrs, text) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.entries(attrs || {}).forEach(([key, value]) => element.setAttribute(key, value));
    if (text !== undefined) element.textContent = text;
    svg.appendChild(element);
    return element;
  }

  // Grid and tick labels.
  for (let i = 0; i <= 5; i++) {
    const fraction = i / 5;

    const x = left + fraction * plotWidth;
    const xValue = xMin + fraction * (xMax - xMin);
    add("line", {x1:x, y1:top, x2:x, y2:top+plotHeight, stroke:cssVariable("--chart-grid"), "stroke-width":"1"});
    add("text", {x:x, y:top+plotHeight+24, "text-anchor":"middle", fill:cssVariable("--muted"), "font-size":"12"}, xValue.toFixed(1));

    const y = top + plotHeight - fraction * plotHeight;
    const yValue = yMin + fraction * (yMax - yMin);
    add("line", {x1:left, y1:y, x2:left+plotWidth, y2:y, stroke:cssVariable("--chart-grid"), "stroke-width":"1"});
    add("text", {x:left-10, y:y+4, "text-anchor":"end", fill:cssVariable("--muted"), "font-size":"12"}, yValue.toFixed(3));
  }

  // Strong zero axes.
  if (xMin <= 0 && xMax >= 0) {
    const x0 = xScale(0);
    add("line", {x1:x0, y1:top, x2:x0, y2:top+plotHeight, stroke:cssVariable("--chart-axis"), "stroke-width":"1.6"});
  }
  if (yMin <= 0 && yMax >= 0) {
    const y0 = yScale(0);
    add("line", {x1:left, y1:y0, x2:left+plotWidth, y2:y0, stroke:cssVariable("--chart-axis"), "stroke-width":"1.6"});
  }

  // Axis labels.
  add("text", {x:left + plotWidth/2, y:height-16, "text-anchor":"middle", fill:cssVariable("--text"), "font-size":"13"}, xLabel);
  const yText = add("text", {x:18, y:top + plotHeight/2, "text-anchor":"middle", fill:cssVariable("--text"), "font-size":"13"}, yLabel);
  yText.setAttribute("transform", `rotate(-90 18 ${top + plotHeight/2})`);

  // Line.
  const points = xValues.map((x, index) => `${xScale(x)},${yScale(yValues[index])}`).join(" ");
  add("polyline", {
    points: points,
    fill: "none",
    stroke: cssVariable("--accent"),
    "stroke-width": "2.5",
    "stroke-linejoin": "round",
    "stroke-linecap": "round"
  });

  xValues.forEach((x, index) => {
    const circle = add("circle", {
      cx: xScale(x),
      cy: yScale(yValues[index]),
      r: 4.5,
      fill: cssVariable("--accent")
    });
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = `${xLabel}: ${x}; ${yLabel}: ${yValues[index].toFixed(6)}`;
    circle.appendChild(title);
  });
}

function renderResultsTable(rows) {
  if (!rows.length) {
    byId("results-table").innerHTML = "";
    return;
  }

  const columns = Object.keys(rows[0]);

  let html = "<table><thead><tr>";
  columns.forEach(column => html += `<th>${column}</th>`);
  html += "</tr></thead><tbody>";

  rows.slice(0, 300).forEach(row => {
    html += "<tr>";

    columns.forEach(column => {
      const value = row[column];

      let display = "";
      if (value !== null && value !== undefined) {
        if (typeof value === "number") {
          display = Number(value).toPrecision(6);
        } else {
          display = value;
        }
      }

      html += `<td>${display}</td>`;
    });

    html += "</tr>";
  });

  html += "</tbody></table>";
  byId("results-table").innerHTML = html;
}

function updateOutputControls() {
  const formatSelect = byId("output-format");
  const plotCheckbox = byId("include-excel-plots");
  const plotField = byId("excel-plot-options");
  const downloadButton = byId("download-results");

  if (!formatSelect || !plotCheckbox || !downloadButton) {
    return;
  }

  const format = formatSelect.value;
  const isExcel = format === "xlsx";

  plotCheckbox.disabled = !isExcel;
  if (plotField) {
    plotField.style.opacity = isExcel ? "1" : "0.55";
  }

  if (format === "csv") {
    downloadButton.textContent = "Download CSV results";
  } else if (format === "tsv") {
    downloadButton.textContent = "Download TSV results";
  } else {
    downloadButton.textContent = "Download Excel results";
  }
}

async function downloadBatchResults() {
  if (!batchPayload) return;

  const button = byId("download-results");
  const format = byId("output-format").value;
  button.disabled = true;

  try {
    if (format === "xlsx") {
      button.textContent = "Building Excel workbook...";

      const workbook = await makeOutputWorkbook({
        results: batchPayload.results,
        compactResults: batchPayload.results_compact,
        wideResults: batchPayload.results_wide,
        calibrationRows: batchPayload.calibration_rows,
        calibrations: batchPayload.calibrations,
        includePlots: byId("include-excel-plots").checked
      });

      const blob = await workbookToBlob(workbook);
      downloadBlob(blob, batchPayload.output_basename + ".xlsx");
      trackAnalyticsEvent(
        "excel-results-download",
        "Excel results download"
      );
    } else {
      const mainResults = batchPayload.results_compact.length
        ? batchPayload.results_compact
        : batchPayload.results_wide;

      const delimiter = format === "tsv" ? "\t" : ",";
      const blob = makeDelimitedBlob(mainResults, delimiter);
      const extension = format === "tsv" ? ".tsv" : ".csv";
      const label = format === "tsv" ? "TSV" : "CSV";

      downloadBlob(blob, batchPayload.output_basename + extension);
      trackAnalyticsEvent(
        format + "-results-download",
        label + " results download"
      );
    }
  } catch (error) {
    showStatus(byId("batch-status"), "error", error.message);
  } finally {
    button.disabled = false;
    updateOutputControls();
  }
}


function updateDoseTargetBasis() {
  const gas = byId("dose-gas").value;
  const field = byId("dose-target-basis-label");
  const select = byId("dose-target-basis");
  const reactive = gas === "CO2" || gas === "H2S";

  field.style.display = reactive ? "flex" : "none";
  if (!reactive) select.value = "molecular";

  const poolOption = select.querySelector('option[value="total_pool"]');
  if (poolOption) {
    poolOption.textContent = gas === "CO2"
      ? "Estimated dissolved inorganic carbon (DIC)"
      : "Estimated dissolved total sulfide";
  }
}

async function initialize() {
  setupTheme();
  setupTabs();
  initializeAnalytics();
  setupTrackedLinks();

  refreshMetricsDisplay();
  refreshGlobalCalculationCount();

  metadata = staticMetadata();

  populateGasSelect(byId("single-gas"), "CO");
  populateGasSelect(byId("dose-gas"), "O2");
  updateDoseTargetBasis();

  byId("single-calculate").addEventListener("click", calculateSingle);
  byId("dose-calculate").addEventListener("click", calculateDose);
  byId("dose-gas").addEventListener("change", updateDoseTargetBasis);
  byId("batch-calculate").addEventListener("click", calculateBatch);
  byId("download-results").addEventListener("click", downloadBatchResults);
  byId("output-format").addEventListener("change", updateOutputControls);
  updateOutputControls();

  byId("calibration-plot-gas").addEventListener("change", renderCalibrationPlot);
  byId("plot-experiment").addEventListener("change", refreshSamples);
  byId("plot-sample").addEventListener("change", refreshGases);
  byId("plot-mode").addEventListener("change", updatePlotMode);
  byId("plot-metric").addEventListener("change", renderSelectedPlot);
  byId("plot-gas").addEventListener("change", renderSelectedPlot);
}

initialize().catch(error => {
  console.error(error);
});
