import {GAS_PROPERTIES} from "./gas-properties.js";
import {calculateGasState, calculateRequiredGasAddition} from "./calculations.js";
import {
  calculateMassTransferAssessment,
  getKlaScreeningEstimate
} from "./mass-transfer.js";
import {
  fitTimeSeriesRate,
  availableRateMetrics
} from "./rate-analysis.js";
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
  makeDelimitedPackageBlob,
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

  if (lastTransferResult) {
    renderTransferPredictionPlot(lastTransferResult);
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
let rateAnalysisRows = [];
let lastTransferExportRow = null;
let lastTransferResult = null;
let transferLiveTimer = null;
let transferExploreUsageRecorded = false;

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

function gasConcentrationToPercent(value, unit) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    throw new Error("Gas concentration must be zero or larger.");
  }

  if (unit === "ppmv") {
    return numericValue / 10000.0;
  }
  if (unit === "percent") {
    return numericValue;
  }

  throw new Error("Unknown gas concentration unit.");
}

function formatHeadspaceConcentration(percent) {
  const ppmv = Number(percent) * 10000.0;
  return `${formatNumber(ppmv, 1)} ppmv (${formatNumber(percent, 4)}%)`;
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

function activateTab(tabName, scrollToPanel = false) {
  const button = document.querySelector(`.tab-button[data-tab="${tabName}"]`);
  const panel = byId("tab-" + tabName);
  if (!button || !panel) return;

  document.querySelectorAll(".tab-button").forEach(item => item.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach(item => item.classList.remove("active"));

  button.classList.add("active");
  panel.classList.add("active");

  if (scrollToPanel) {
    panel.scrollIntoView({behavior: "smooth", block: "start"});
  }
}

function setupTabs() {
  document.querySelectorAll(".tab-button").forEach(button => {
    button.addEventListener("click", () => {
      activateTab(button.dataset.tab, false);
    });
  });

  document.querySelectorAll("[data-open-tab]").forEach(link => {
    link.addEventListener("click", event => {
      event.preventDefault();

      if (link.dataset.openTab === "transfer" && link.dataset.transferSource === "batch") {
        byId("transfer-mode").value = "analyze";
        byId("transfer-rate-source").value = "batch";
        updateTransferMode();
      }

      activateTab(link.dataset.openTab, true);
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

  try {
    const targetMode = byId("dose-target-mode").value;
    const targetUnit = byId("dose-target-unit").value;
    const targetValue = numberValue("dose-target");

    const payload = {
      gas_id: byId("dose-gas").value,
      target_mode: targetMode,
      target_basis: byId("dose-target-basis").value,
      bottle_volume_ml: numberValue("dose-bottle"),
      liquid_volume_ml: numberValue("dose-liquid"),
      temperature_c: numberValue("dose-temperature"),
      salinity_g_l_nacl: numberValue("dose-salinity"),
      ph: optionalNumber("dose-ph"),
      initial_gas_percent: gasConcentrationToPercent(
        numberValue("dose-initial-value"),
        byId("dose-initial-unit").value
      ),
      initial_pressure_bar_abs: numberValue("dose-initial-pressure"),
      dose_gas_percent: gasConcentrationToPercent(
        numberValue("dose-gas-value"),
        byId("dose-gas-unit").value
      ),
      dose_pressure_bar_abs: numberValue("dose-pressure"),
      compressibility_factor: 1.0
    };

    if (targetMode === "dissolved") {
      payload.target_dissolved_umol_l = targetValue;
    } else {
      payload.target_headspace_percent = gasConcentrationToPercent(
        targetValue,
        targetUnit
      );
    }

    const result = calculateRequiredGasAddition(payload);
    recordUsage();
    recordGasCalculations(1);
    trackAnalyticsEvent(
      "gas-dosing",
      "Gas dosing calculation"
    );

    let html = "";
    html += metric("Target gas to add", formatNumber(result.required_target_gas_mmol, 6) + " mmol");
    html += metric("Dosing mixture to add", formatNumber(result.required_dose_mix_volume_mL, 3) + " mL");
    html += metric(
      "Equilibrated headspace",
      formatHeadspaceConcentration(result.final_headspace_percent)
    );
    html += metric("Final headspace amount", formatNumber(result.final_headspace_mmol, 6) + " mmol");
    html += metric("Final partial pressure", formatNumber(result.final_partial_pressure_bar, 6) + " bar");
    html += metric("Estimated final pressure", formatNumber(result.final_pressure_bar_abs, 5) + " bar abs");
    html += metric(
      "Molecular dissolved concentration",
      formatNumber(result.final_molecular_dissolved_umol_L, 3) + " µM"
    );
    html += metric(
      "Molecular dissolved amount",
      formatNumber(result.final_molecular_dissolved_mmol, 6) + " mmol"
    );

    if (result.gas_id === "CO2" && result.speciation) {
      html += metric(
        "Estimated dissolved inorganic carbon (DIC)",
        formatNumber(result.final_reactive_pool_umol_L, 3) + " µM (" +
        formatNumber(result.final_reactive_pool_mmol, 6) + " mmol)"
      );
    }

    if (result.gas_id === "H2S" && result.speciation) {
      html += metric(
        "Estimated dissolved total sulfide",
        formatNumber(result.final_reactive_pool_umol_L, 3) + " µM (" +
        formatNumber(result.final_reactive_pool_mmol, 6) + " mmol)"
      );
    }

    byId("dose-results").innerHTML = html;

    if (result.warnings && result.warnings.length) {
      showStatus(status, "warning", result.warnings.join("<br>"));
    } else {
      showStatus(status, "good", "All good!");
    }
  } catch (error) {
    showStatus(status, "error", error.message);
  }
}

function transferSeriesRows() {
  if (!batchPayload) return [];

  const experiment = byId("transfer-batch-experiment").value;
  const sample = byId("transfer-batch-sample").value;
  const gas = byId("transfer-batch-gas").value;

  return batchPayload.results
    .filter(row =>
      !row.processing_error &&
      String(row.experiment_id) === experiment &&
      String(row.sample_id) === sample &&
      String(row.gas_id) === gas
    )
    .sort((a, b) => Number(a.time_h) - Number(b.time_h));
}

function populateTransferBatchSelectors() {
  const sourceSelect = byId("transfer-rate-source");
  const batchOption = sourceSelect.querySelector('option[value="batch"]');
  const hasBatch = Boolean(batchPayload && batchPayload.results && batchPayload.results.length);

  if (batchOption) batchOption.disabled = !hasBatch;
  if (!hasBatch) {
    if (sourceSelect.value === "batch") sourceSelect.value = "manual";
    updateTransferMode();
    return;
  }

  const rows = batchPayload.results.filter(row => !row.processing_error);
  const experiments = [...new Set(rows.map(row => String(row.experiment_id)))];
  populateSelect(byId("transfer-batch-experiment"), experiments);
  refreshTransferBatchSamples();
}

function refreshTransferBatchSamples() {
  if (!batchPayload) return;
  const experiment = byId("transfer-batch-experiment").value;
  const rows = batchPayload.results.filter(row =>
    !row.processing_error && String(row.experiment_id) === experiment
  );
  const samples = [...new Set(rows.map(row => String(row.sample_id)))];
  populateSelect(byId("transfer-batch-sample"), samples);
  refreshTransferBatchGases();
}

function refreshTransferBatchGases() {
  if (!batchPayload) return;
  const experiment = byId("transfer-batch-experiment").value;
  const sample = byId("transfer-batch-sample").value;
  const rows = batchPayload.results.filter(row =>
    !row.processing_error &&
    String(row.experiment_id) === experiment &&
    String(row.sample_id) === sample
  );
  const gases = [...new Set(rows.map(row => String(row.gas_id)))];
  populateSelect(byId("transfer-batch-gas"), gases);
  refreshTransferRateMetrics();
}

function refreshTransferRateMetrics() {
  const rows = transferSeriesRows();
  const gas = byId("transfer-batch-gas").value;
  const metrics = availableRateMetrics(rows, gas);
  const select = byId("transfer-rate-basis");
  select.innerHTML = "";

  for (const metric of metrics) {
    const option = document.createElement("option");
    option.value = metric.value;
    option.textContent = metric.label;
    select.appendChild(option);
  }

  if (!metrics.length) {
    const option = document.createElement("option");
    option.value = "total_bottle_mmol";
    option.textContent = "Total bottle amount";
    select.appendChild(option);
  }

  const hasActualSampling = rows.some(row =>
    Number(row.liquid_sample_mL || 0) > 0 || Number(row.headspace_sample_mL || 0) > 0
  );
  const preferred = (hasActualSampling
    ? metrics.find(item => item.value === "sampling_corrected_total_mmol")
    : null) || metrics.find(item => item.value === "total_bottle_mmol");
  if (preferred) select.value = preferred.value;

  refreshTransferTimeRange();
}

function refreshTransferTimeRange() {
  const rows = transferSeriesRows();
  const times = [...new Set(
    rows.map(row => Number(row.time_h)).filter(Number.isFinite)
  )].sort((a, b) => a - b);

  populateSelect(byId("transfer-time-start"), times);
  populateSelect(byId("transfer-time-end"), times);
  if (times.length) {
    byId("transfer-time-start").value = String(times[0]);
    byId("transfer-time-end").value = String(times[times.length - 1]);
  }
}

function fitSelectedBatchRate() {
  const rows = transferSeriesRows();
  const fit = fitTimeSeriesRate({
    rows,
    metric: byId("transfer-rate-basis").value,
    time_start_h: Number(byId("transfer-time-start").value),
    time_end_h: Number(byId("transfer-time-end").value)
  });

  if (fit.mean_bottle_volume_mL !== null) {
    byId("transfer-bottle").value = fit.mean_bottle_volume_mL;
  }
  if (fit.mean_liquid_volume_mL !== null) {
    byId("transfer-liquid").value = fit.mean_liquid_volume_mL;
  }
  if (fit.mean_temperature_C !== null) {
    byId("transfer-temperature").value = fit.mean_temperature_C;
  }
  if (fit.mean_pressure_bar_abs !== null) {
    byId("transfer-pressure").value = fit.mean_pressure_bar_abs;
  }
  if (fit.mean_gas_percent !== null) {
    byId("transfer-gas-value").value = fit.mean_gas_percent;
    byId("transfer-gas-unit").value = "percent";
  }
  if (fit.mean_salinity_g_L_NaCl !== null) {
    byId("transfer-salinity").value = fit.mean_salinity_g_L_NaCl;
  }

  byId("transfer-gas").value = byId("transfer-batch-gas").value;
  updateTransferHenryControls(true);
  updateTransferControls();

  let fitHtml = "";
  fitHtml += metric("Rate basis", fit.metric_label);
  fitHtml += metric("Selected interval", `${formatNumber(fit.time_start_h, 3)}-${formatNumber(fit.time_end_h, 3)} h`);
  fitHtml += metric("Points", String(fit.number_of_points));
  fitHtml += metric("Signed rate", `${formatNumber(fit.signed_rate_mmol_d, 5)} mmol/day`);
  fitHtml += metric("Direction", fit.direction.replace("_", " "));
  fitHtml += metric("R²", formatNumber(fit.r_squared, 4));
  byId("transfer-rate-fit-results").innerHTML = fitHtml;

  return fit;
}

function currentTransferPayload(observedRateMmolD) {
  return {
    gas_id: byId("transfer-gas").value,
    observed_rate_value: observedRateMmolD,
    observed_rate_unit: "mmol_d",
    bottle_volume_ml: numberValue("transfer-bottle"),
    liquid_volume_ml: numberValue("transfer-liquid"),
    temperature_c: numberValue("transfer-temperature"),
    pressure_bar_abs: numberValue("transfer-pressure"),
    headspace_gas_percent: gasConcentrationToPercent(
      numberValue("transfer-gas-value"),
      byId("transfer-gas-unit").value
    ),
    salinity_g_l_nacl: numberValue("transfer-salinity"),
    kla_source: byId("transfer-kla-source").value,
    vessel_class: byId("transfer-vessel").value,
    shaking_rpm: numberValue("transfer-rpm"),
    custom_kla_h: optionalNumber("transfer-custom-kla"),
    henry_source: byId("transfer-henry-source").value,
    custom_hcp_ref: optionalNumber("transfer-custom-hcp"),
    custom_henry_B_K: optionalNumber("transfer-custom-henry-b")
  };
}

function renderTransferPredictionPlot(result) {
  const svg = byId("transfer-kla-chart");
  const explanation = byId("transfer-plot-explanation");
  if (!svg) return;

  const observedRate = Number(result.observed_rate_mmol_d);
  const centralKla = Number(result.kla_central_h);
  const lowKla = Number(result.kla_low_h);
  const highKla = Number(result.kla_high_h);
  const requiredKla = Number(result.minimum_required_kla_h);

  const referenceCapacity = result.kla_source === "estimate"
    ? Number(result.transfer_capacity_high_mmol_d)
    : Number(result.transfer_capacity_central_mmol_d);

  const xMax = Math.max(
    0.05,
    observedRate * 1.8,
    Number.isFinite(referenceCapacity) ? referenceCapacity * 1.25 : 0
  );

  const yReference = result.kla_source === "estimate" ? highKla : centralKla;
  const yMax = Math.max(
    5,
    yReference * 1.35,
    Number.isFinite(requiredKla) ? requiredKla * 1.35 : 0
  );

  const denominator = Number(result.liquid_volume_L) *
    Number(result.equilibrium_dissolved_mmol_L) * 24.0;

  if (!window.d3) {
    // Basic fallback if the D3 CDN does not load.
    svg.innerHTML = "";
    if (explanation) {
      explanation.textContent = "D3 could not be loaded, so the interactive plot is unavailable.";
    }
    return;
  }

  const d3 = window.d3;
  const width = 900;
  const height = 500;
  const margin = {top: 26, right: 36, bottom: 68, left: 78};
  const innerWidth = width - margin.left - margin.right;
  const innerHeight = height - margin.top - margin.bottom;

  const textColor = cssVariable("--chart-text") || cssVariable("--text");
  const mutedColor = cssVariable("--chart-muted") || cssVariable("--muted");
  const gridColor = cssVariable("--chart-grid");
  const axisColor = cssVariable("--chart-axis");
  const curveColor = cssVariable("--chart-primary") || cssVariable("--accent-dark");
  const currentColor = cssVariable("--chart-current") || "#a24f2f";
  const bandColor = cssVariable("--chart-band") || "#8fbea0";
  const referenceColor = cssVariable("--chart-reference") || cssVariable("--accent");
  const surfaceColor = cssVariable("--surface") || "#ffffff";

  svg.innerHTML = "";
  const root = d3.select(svg)
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  root.append("rect")
    .attr("x", 0)
    .attr("y", 0)
    .attr("width", width)
    .attr("height", height)
    .attr("rx", 14)
    .attr("fill", surfaceColor)
    .attr("opacity", 0.04);

  const plot = root.append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  const xScale = d3.scaleLinear().domain([0, xMax]).range([0, innerWidth]);
  const yScale = d3.scaleLinear().domain([0, yMax]).range([innerHeight, 0]);

  const xTicks = Math.max(4, Math.min(6, Math.round(xMax < 1 ? 4 : 5)));
  const yTicks = 5;

  plot.append("g")
    .attr("class", "grid")
    .attr("transform", `translate(0,${innerHeight})`)
    .call(d3.axisBottom(xScale).ticks(xTicks).tickSize(-innerHeight).tickFormat(() => ""))
    .call(g => g.selectAll("line").attr("stroke", gridColor).attr("stroke-width", 1))
    .call(g => g.select(".domain").remove());

  plot.append("g")
    .attr("class", "grid")
    .call(d3.axisLeft(yScale).ticks(yTicks).tickSize(-innerWidth).tickFormat(() => ""))
    .call(g => g.selectAll("line").attr("stroke", gridColor).attr("stroke-width", 1))
    .call(g => g.select(".domain").remove());

  const xFormatter = xMax < 1 ? d3.format(".3f") : d3.format(".2f");
  const yFormatter = yMax < 10 ? d3.format(".2f") : d3.format(".1f");

  plot.append("g")
    .attr("transform", `translate(0,${innerHeight})`)
    .call(d3.axisBottom(xScale).ticks(xTicks).tickFormat(xFormatter))
    .call(g => g.selectAll("text").attr("fill", mutedColor).style("font-size", "12px"))
    .call(g => g.selectAll("line").attr("stroke", axisColor))
    .call(g => g.select(".domain").attr("stroke", axisColor).attr("stroke-width", 1.8));

  plot.append("g")
    .call(d3.axisLeft(yScale).ticks(yTicks).tickFormat(yFormatter))
    .call(g => g.selectAll("text").attr("fill", mutedColor).style("font-size", "12px"))
    .call(g => g.selectAll("line").attr("stroke", axisColor))
    .call(g => g.select(".domain").attr("stroke", axisColor).attr("stroke-width", 1.8));

  if (result.kla_source === "estimate") {
    plot.append("rect")
      .attr("x", 0)
      .attr("y", yScale(highKla))
      .attr("width", innerWidth)
      .attr("height", Math.max(0, yScale(lowKla) - yScale(highKla)))
      .attr("fill", bandColor)
      .attr("opacity", 0.18);
  }

  plot.append("line")
    .attr("x1", 0)
    .attr("x2", innerWidth)
    .attr("y1", yScale(centralKla))
    .attr("y2", yScale(centralKla))
    .attr("stroke", referenceColor)
    .attr("stroke-width", 2)
    .attr("stroke-dasharray", "8 6");

  const lineData = d3.range(0, 81).map(i => {
    const rate = xMax * i / 80;
    const klaRequired = denominator > 0 ? rate / denominator : 0;
    return { rate, klaRequired: Math.min(klaRequired, yMax) };
  });

  const line = d3.line()
    .x(d => xScale(d.rate))
    .y(d => yScale(d.klaRequired))
    .curve(d3.curveMonotoneX);

  plot.append("path")
    .datum(lineData)
    .attr("fill", "none")
    .attr("stroke", curveColor)
    .attr("stroke-width", 3)
    .attr("stroke-linecap", "round")
    .attr("stroke-linejoin", "round")
    .attr("d", line);

  const observedX = xScale(Math.min(observedRate, xMax));
  plot.append("line")
    .attr("x1", observedX)
    .attr("x2", observedX)
    .attr("y1", 0)
    .attr("y2", innerHeight)
    .attr("stroke", currentColor)
    .attr("stroke-width", 2.5)
    .attr("stroke-dasharray", "5 5");

  if (Number.isFinite(requiredKla) && requiredKla <= yMax) {
    plot.append("circle")
      .attr("cx", observedX)
      .attr("cy", yScale(requiredKla))
      .attr("r", 6)
      .attr("fill", currentColor)
      .attr("stroke", surfaceColor)
      .attr("stroke-width", 2);
  }

  const legend = root.append("g").attr("transform", `translate(${margin.left},12)`);
  let legendX = 0;
  function legendItem(color, label, opts = {}) {
    const group = legend.append("g").attr("transform", `translate(${legendX},0)`);
    if (opts.band) {
      group.append("rect").attr("x", 0).attr("y", 1).attr("width", 22).attr("height", 10).attr("fill", color).attr("opacity", 0.22);
    } else {
      group.append("line")
        .attr("x1", 0)
        .attr("x2", 22)
        .attr("y1", 6)
        .attr("y2", 6)
        .attr("stroke", color)
        .attr("stroke-width", opts.width || 3)
        .attr("stroke-dasharray", opts.dash || null);
    }
    group.append("text")
      .attr("x", 28)
      .attr("y", 10)
      .attr("fill", textColor)
      .style("font-size", "12px")
      .style("font-weight", "600")
      .text(label);
    legendX += 28 + label.length * 7.2 + 18;
  }
  legendItem(curveColor, "required kLa");
  if (result.kla_source === "estimate") {
    legendItem(bandColor, "estimated range", { band: true });
  }
  legendItem(referenceColor, result.kla_source === "estimate" ? "central kLa" : "entered kLa", { dash: "8 6", width: 2 });
  legendItem(currentColor, "your rate", { dash: "5 5", width: 2.5 });

  root.append("text")
    .attr("x", margin.left + innerWidth / 2)
    .attr("y", height - 18)
    .attr("text-anchor", "middle")
    .attr("fill", textColor)
    .style("font-size", "14px")
    .style("font-weight", "600")
    .text("Gas uptake rate (mmol/day)");

  root.append("text")
    .attr("x", 20)
    .attr("y", margin.top + innerHeight / 2)
    .attr("text-anchor", "middle")
    .attr("fill", textColor)
    .style("font-size", "14px")
    .style("font-weight", "600")
    .attr("transform", `rotate(-90 20 ${margin.top + innerHeight / 2})`)
    .text("Required kLa (h⁻¹)");

  const corner = plot.append("g").attr("transform", `translate(${Math.max(0, innerWidth - 205)},18)`);
  corner.append("rect")
    .attr("width", 192)
    .attr("height", result.kla_source === "estimate" ? 64 : 46)
    .attr("rx", 10)
    .attr("fill", surfaceColor)
    .attr("opacity", 0.92)
    .attr("stroke", gridColor);
  const cornerText = [
    `Rate: ${formatNumber(observedRate, 4)} mmol/day`,
    `Required kLa: ${formatNumber(requiredKla, 3)} h⁻¹`
  ];
  if (result.kla_source === "estimate") {
    cornerText.push(`Estimate band: ${formatNumber(lowKla, 2)}-${formatNumber(highKla, 2)} h⁻¹`);
  } else {
    cornerText.push(`Entered kLa: ${formatNumber(centralKla, 2)} h⁻¹`);
  }
  corner.selectAll("text")
    .data(cornerText)
    .enter()
    .append("text")
    .attr("x", 12)
    .attr("y", (_, i) => 18 + i * 16)
    .attr("fill", textColor)
    .style("font-size", "12px")
    .style("font-weight", (_, i) => i === 0 ? "600" : "500")
    .text(d => d);

  if (explanation) {
    if (result.kla_source === "estimate") {
      explanation.innerHTML =
        `<strong>How to read this:</strong> the sloped line shows the k<sub>L</sub>a needed to sustain a given uptake rate. ` +
        `The green band is the estimated k<sub>L</sub>a range for the selected bottle, and the red line marks your current rate.`;
    } else {
      explanation.innerHTML =
        `<strong>How to read this:</strong> the sloped line shows the k<sub>L</sub>a needed to sustain a given uptake rate. ` +
        `The dashed line is your entered k<sub>L</sub>a, and the red line marks your current rate.`;
    }
  }
}

function transferExportRow(result, rateFit, sourceLabel) {
  const row = {
    analysis_source: sourceLabel,
    experiment_id: rateFit ? byId("transfer-batch-experiment").value : "",
    sample_id: rateFit ? byId("transfer-batch-sample").value : "",
    gas_id: result ? result.gas_id : byId("transfer-gas").value,
    rate_basis: rateFit ? rateFit.metric : "manual_rate",
    time_start_h: rateFit ? rateFit.time_start_h : null,
    time_end_h: rateFit ? rateFit.time_end_h : null,
    number_of_points: rateFit ? rateFit.number_of_points : null,
    slope_mmol_h: rateFit ? rateFit.slope_mmol_h : null,
    signed_rate_mmol_d: rateFit ? rateFit.signed_rate_mmol_d : Number(byId("transfer-rate").value),
    rate_direction: rateFit ? rateFit.direction : "manual",
    r_squared: rateFit ? rateFit.r_squared : null,
    mass_transfer_assessed: Boolean(result)
  };

  if (!result) return row;

  return Object.assign(row, {
    rate_to_compare_mmol_d: result.observed_rate_mmol_d,
    bottle_volume_mL: result.bottle_volume_L * 1000.0,
    liquid_volume_mL: result.liquid_volume_L * 1000.0,
    headspace_volume_mL: result.headspace_volume_L * 1000.0,
    temperature_C: result.temperature_K - 273.15,
    pressure_bar_abs: result.pressure_bar_abs,
    headspace_gas_percent: result.headspace_gas_percent,
    headspace_gas_ppmv: result.headspace_gas_ppmv,
    partial_pressure_bar: result.partial_pressure_bar,
    equilibrium_dissolved_mmol_L: result.equilibrium_dissolved_mmol_L,
    headspace_gas_mmol: result.headspace_gas_mmol,
    equilibrium_dissolved_mmol: result.equilibrium_dissolved_mmol,
    total_equilibrium_gas_mmol: result.total_equilibrium_gas_mmol,
    estimated_depletion_time_hours: result.estimated_depletion_time_hours,
    henry_source: result.henry_source,
    henry_overridden: result.henry_overridden,
    henry_reference_Hcp_mol_m3_Pa: result.henry_reference_Hcp_mol_m3_Pa,
    henry_B_K: result.henry_B_K,
    kla_source: result.kla_source,
    kla_literature_note: result.kla_literature_note || "",
    kla_literature_citation: result.kla_literature_citation || "",
    vessel_class: result.vessel_label || "",
    shaking_rpm: result.shaking_rpm,
    kla_low_h: result.kla_low_h,
    kla_central_h: result.kla_central_h,
    kla_high_h: result.kla_high_h,
    transfer_capacity_low_mmol_d: result.transfer_capacity_low_mmol_d,
    transfer_capacity_central_mmol_d: result.transfer_capacity_central_mmol_d,
    transfer_capacity_high_mmol_d: result.transfer_capacity_high_mmol_d,
    transfer_demand_ratio_central: result.transfer_demand_ratio_central,
    minimum_required_kla_h: result.minimum_required_kla_h,
    assessment: result.assessment_message,
    warnings: (result.warnings || []).join(" | ")
  });
}

function saveRateAnalysisRow(row) {
  const keyFields = [
    "analysis_source", "experiment_id", "sample_id", "gas_id",
    "rate_basis", "time_start_h", "time_end_h"
  ];
  const key = keyFields.map(field => String(row[field] ?? "")).join("|");
  const existingIndex = rateAnalysisRows.findIndex(existing =>
    keyFields.map(field => String(existing[field] ?? "")).join("|") === key
  );

  if (existingIndex >= 0) {
    rateAnalysisRows[existingIndex] = row;
  } else {
    rateAnalysisRows.push(row);
  }

  if (batchPayload) batchPayload.rate_analyses = rateAnalysisRows;
}

async function calculateTransfer({trackUsage = true, saveAnalysis = true, live = false} = {}) {
  const status = byId("transfer-status");
  clearStatus(status);

  try {
    const mode = byId("transfer-mode").value;
    const rateSource = byId("transfer-rate-source").value;
    const assessMassTransfer = mode === "explore" || byId("transfer-enable-mass").checked;

    let rateFit = null;
    let rateToCompare;

    if (mode === "analyze" && rateSource === "batch") {
      rateFit = fitSelectedBatchRate();
      if (rateFit.direction === "uptake") {
        rateToCompare = rateFit.uptake_rate_mmol_d;
      } else {
        rateToCompare = Math.abs(rateFit.signed_rate_mmol_d);
      }
    } else {
      const manualRate = numberValue("transfer-rate");
      const manualUnit = byId("transfer-rate-unit").value;
      const liquidL = numberValue("transfer-liquid") / 1000.0;
      if (manualUnit === "mmol_d") rateToCompare = manualRate;
      else if (manualUnit === "umol_d") rateToCompare = manualRate / 1000.0;
      else if (manualUnit === "mmol_h") rateToCompare = manualRate * 24.0;
      else if (manualUnit === "mmol_L_d") rateToCompare = manualRate * liquidL;
      else throw new Error("Unknown rate unit.");
    }

    let result = null;
    let massTransferNote = "";
    if (assessMassTransfer) {
      if (rateFit && rateFit.direction === "production") {
        massTransferNote =
          "The selected interval shows net gas production. The fitted rate is retained, but the current mass-transfer screen models gas uptake only and is therefore not applied.";
      } else {
        result = calculateMassTransferAssessment(currentTransferPayload(rateToCompare));
      }
    }

    const shouldRecordExploreUse = mode === "explore" && !transferExploreUsageRecorded;
    const shouldRecordAnalyzeUse = mode !== "explore" && trackUsage && !live;

    if ((shouldRecordExploreUse && result) || shouldRecordAnalyzeUse) {
      recordUsage();
      recordGasCalculations(1);
      trackAnalyticsEvent("mass-transfer-analysis", "Rate and mass transfer analysis");
      if (mode === "explore") transferExploreUsageRecorded = true;
    }

    let html = "";
    if (result) {
      html += metric("Equilibrium concentration (C*)", formatNumber(result.equilibrium_dissolved_umol_L, 3) + " µM");
      html += metric("kLa used", formatNumber(result.kla_central_h, 2) + " h⁻¹");
      if (result.kla_source === "estimate") {
        html += metric("kLa range", formatNumber(result.kla_low_h, 2) + "-" + formatNumber(result.kla_high_h, 2) + " h⁻¹");
      }
      html += metric("Transfer capacity", formatNumber(result.transfer_capacity_central_mmol_d, 4) + " mmol/day");
      html += metric("Rate", formatNumber(result.observed_rate_mmol_d, 4) + " mmol/day");
      html += metric("Headspace gas", formatNumber(result.headspace_gas_mmol, 5) + " mmol");
      html += metric("Total gas inventory", formatNumber(result.total_equilibrium_gas_mmol, 5) + " mmol");
      if (result.estimated_depletion_time_hours !== null) {
        html += metric("Inventory / rate", formatNumber(result.estimated_depletion_time_hours, 2) + " h");
      }
      html += metric("Demand ratio", Number.isFinite(result.transfer_demand_ratio_central) ? formatNumber(result.transfer_demand_ratio_central, 3) : "∞");
      html += metric("Minimum kLa", Number.isFinite(result.minimum_required_kla_h) ? formatNumber(result.minimum_required_kla_h, 2) + " h⁻¹" : "∞");
      lastTransferResult = result;
      renderTransferPredictionPlot(result);
      byId("transfer-prediction-plots").classList.remove("hidden");
    } else {
      lastTransferResult = null;
      byId("transfer-prediction-plots").classList.add("hidden");
    }

    byId("transfer-results").innerHTML = html;

    const exportRow = transferExportRow(
      result,
      rateFit,
      mode === "explore" ? "explore_prediction" : rateSource
    );
    if (!rateFit) {
      exportRow.signed_rate_mmol_d = rateToCompare;
    }
    lastTransferExportRow = exportRow;
    byId("transfer-download-analysis").disabled = false;

    if (saveAnalysis && mode === "analyze") {
      saveRateAnalysisRow(exportRow);
    }
    if (saveAnalysis && mode === "explore" && !live) {
      saveRateAnalysisRow(exportRow);
    }

    if (result) {
      showStatus(status, result.assessment_level, result.assessment_message);
    } else if (rateFit) {
      showStatus(
        status,
        massTransferNote ? "warning" : "good",
        massTransferNote || "Rate fitted. Mass-transfer screening was left off."
      );
    } else {
      byId("transfer-results").innerHTML = metric(
        "Entered rate",
        formatNumber(rateToCompare, 5) + " mmol/day"
      );
      showStatus(status, "good", "Rate recorded. Mass-transfer screening was left off.");
    }

    return {result, rateFit, exportRow};
  } catch (error) {
    if (!live) {
      byId("transfer-results").innerHTML = "";
      showStatus(status, "error", error.message);
    }
    return null;
  }
}

function updateTransferMode() {
  const mode = byId("transfer-mode").value;
  const rateSource = byId("transfer-rate-source").value;
  const explore = mode === "explore";
  const batchSource = !explore && rateSource === "batch";

  byId("transfer-rate-source-label").classList.toggle("hidden", explore);
  byId("transfer-batch-controls").classList.toggle("hidden", !batchSource);
  byId("transfer-manual-rate-controls").classList.toggle("hidden", batchSource);
  byId("transfer-enable-mass-label").classList.toggle("hidden", explore);
  byId("transfer-calculate").classList.toggle("hidden", explore);
  byId("transfer-save-scenario").classList.toggle("hidden", !explore);
  byId("transfer-mode-note").textContent = explore
    ? "Change the settings below; the prediction updates live."
    : (batchSource
      ? "Choose a time interval below; Calculate saves the fitted rate to Rates_mass_transfer and can screen gas transfer."
      : "Enter a rate below; mass-transfer screening is optional.");

  if (!explore) transferExploreUsageRecorded = false;
  if (explore) scheduleTransferLiveUpdate();
}

function scheduleTransferLiveUpdate() {
  if (byId("transfer-mode").value !== "explore") return;
  clearTimeout(transferLiveTimer);
  transferLiveTimer = setTimeout(() => {
    calculateTransfer({trackUsage: false, saveAnalysis: false, live: true});
  }, 120);
}

function downloadCurrentTransferAnalysis() {
  if (!lastTransferExportRow) return;
  const blob = makeDelimitedBlob([lastTransferExportRow], ",");
  downloadBlob(blob, "EGasboard_rate_mass_transfer.csv");
  trackAnalyticsEvent("rate-transfer-download", "Rate mass transfer CSV download");
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

    rateAnalysisRows = [];
    lastTransferExportRow = null;

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
      rate_analyses: rateAnalysisRows,
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
    populateTransferBatchSelectors();
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
  const scopeField = byId("delimited-output-options");
  const downloadButton = byId("download-results");

  if (!formatSelect || !plotCheckbox || !downloadButton) return;

  const format = formatSelect.value;
  const isExcel = format === "xlsx";

  plotCheckbox.disabled = !isExcel;
  if (plotField) plotField.style.opacity = isExcel ? "1" : "0.55";
  if (scopeField) scopeField.classList.toggle("hidden", isExcel);

  if (format === "csv") {
    downloadButton.textContent = byId("output-scope").value === "full"
      ? "Download CSV data package"
      : "Download CSV results";
  } else if (format === "tsv") {
    downloadButton.textContent = byId("output-scope").value === "full"
      ? "Download TSV data package"
      : "Download TSV results";
  } else {
    downloadButton.textContent = "Download Excel results";
  }
}

function calibrationFitRowsForExport() {
  if (!batchPayload) return [];
  const rows = [];
  for (const [gasId, fitRows] of Object.entries(batchPayload.calibration_fits || {})) {
    for (const row of fitRows) {
      rows.push({gas_id: gasId, ...row});
    }
  }
  return rows;
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
        calibrationSummary: batchPayload.calibration_summary,
        rateAnalyses: rateAnalysisRows,
        includePlots: byId("include-excel-plots").checked
      });

      const blob = await workbookToBlob(workbook);
      downloadBlob(blob, batchPayload.output_basename + ".xlsx");
      trackAnalyticsEvent("excel-results-download", "Excel results download");
    } else {
      const delimiter = format === "tsv" ? "\t" : ",";
      const extension = format === "tsv" ? ".tsv" : ".csv";
      const label = format === "tsv" ? "TSV" : "CSV";
      const scope = byId("output-scope").value;

      if (scope === "full") {
        button.textContent = `Building ${label} data package...`;
        const tables = {
          Results: batchPayload.results_compact,
          Rates_mass_transfer: rateAnalysisRows,
          Extended_data: batchPayload.results_wide,
          Calibration_summary: batchPayload.calibration_summary,
          Calibration_fits: calibrationFitRowsForExport()
        };
        const blob = await makeDelimitedPackageBlob(tables, delimiter);
        downloadBlob(blob, batchPayload.output_basename + `_${format}_package.zip`);
        trackAnalyticsEvent(`${format}-package-download`, `${label} full data package download`);
      } else {
        const blob = makeDelimitedBlob(batchPayload.results_compact, delimiter);
        downloadBlob(blob, batchPayload.output_basename + extension);
        trackAnalyticsEvent(`${format}-results-download`, `${label} results download`);
      }
    }
  } catch (error) {
    showStatus(byId("batch-status"), "error", error.message);
  } finally {
    button.disabled = false;
    updateOutputControls();
  }
}

function updateDoseControls() {
  const gas = byId("dose-gas").value;
  const targetMode = byId("dose-target-mode").value;
  const targetUnit = byId("dose-target-unit");
  const targetBasisField = byId("dose-target-basis-label");
  const targetBasis = byId("dose-target-basis");
  const targetLabelText = byId("dose-target-label-text");
  const reactive = gas === "CO2" || gas === "H2S";

  if (targetMode === "dissolved") {
    targetLabelText.textContent = "Target dissolved concentration";
    targetUnit.innerHTML = '<option value="umol_L">µM</option>';
    targetBasisField.style.display = reactive ? "flex" : "none";
    if (!reactive) targetBasis.value = "molecular";
  } else {
    targetLabelText.textContent = "Target equilibrated headspace";
    targetUnit.innerHTML = [
      '<option value="ppmv">ppmv</option>',
      '<option value="percent">%</option>'
    ].join("");
    targetBasisField.style.display = "none";
    targetBasis.value = "molecular";
  }

  const poolOption = targetBasis.querySelector('option[value="total_pool"]');
  if (poolOption) {
    poolOption.textContent = gas === "CO2"
      ? "Estimated dissolved inorganic carbon (DIC)"
      : "Estimated dissolved total sulfide";
  }
}

function updateTransferHenryControls(resetCustomValues = false) {
  const source = byId("transfer-henry-source").value;
  const customMode = source === "custom";
  const gasId = byId("transfer-gas").value;
  const gas = GAS_PROPERTIES[gasId];

  byId("transfer-custom-hcp-label").classList.toggle("hidden", !customMode);
  byId("transfer-custom-henry-b-label").classList.toggle("hidden", !customMode);

  if (gas && resetCustomValues) {
    byId("transfer-custom-hcp").value = gas.hcp_ref;
    byId("transfer-custom-henry-b").value = gas.B_K;
  }

  const preview = byId("transfer-henry-preview");
  if (!gas) {
    preview.textContent = "";
    return;
  }

  if (customMode) {
    preview.textContent = "Custom Hcp / B active.";
  } else {
    preview.innerHTML =
      gasId + " Hcp(25 °C): <strong>" +
      Number(gas.hcp_ref).toExponential(3) +
      " mol m<sup>−3</sup> Pa<sup>−1</sup></strong>; B = " +
      formatNumber(gas.B_K, 0) + " K.";
  }
}

function updateTransferControls() {
  const source = byId("transfer-kla-source").value;
  const estimateMode = source === "estimate";

  byId("transfer-vessel-label").classList.toggle("hidden", !estimateMode);
  byId("transfer-rpm-label").classList.toggle("hidden", !estimateMode);
  byId("transfer-custom-kla-label").classList.toggle("hidden", estimateMode);

  const preview = byId("transfer-kla-preview");

  if (estimateMode) {
    try {
      const estimate = getKlaScreeningEstimate(
        byId("transfer-vessel").value,
        numberValue("transfer-rpm"),
        byId("transfer-gas").value
      );

      preview.innerHTML =
        "Estimated kLa: <strong>" +
        formatNumber(estimate.central_kla_h, 1) +
        " h<sup>−1</sup></strong> (" +
        formatNumber(estimate.low_kla_h, 1) +
        "-" +
        formatNumber(estimate.high_kla_h, 1) +
        " h<sup>−1</sup>)." +
        (estimate.high_speed_extrapolation ? " 400 rpm is higher uncertainty." : "");
    } catch (error) {
      preview.textContent = error.message;
    }
  } else {
    preview.textContent = "Custom kLa active.";
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
  populateGasSelect(byId("transfer-gas"), "CO");
  updateDoseControls();
  updateTransferHenryControls(true);
  updateTransferControls();

  byId("single-calculate").addEventListener("click", calculateSingle);
  byId("dose-calculate").addEventListener("click", calculateDose);
  byId("dose-gas").addEventListener("change", updateDoseControls);
  byId("dose-target-mode").addEventListener("change", updateDoseControls);
  byId("transfer-calculate").addEventListener("click", () => {
    calculateTransfer({trackUsage: true, saveAnalysis: true, live: false});
  });
  byId("transfer-save-scenario").addEventListener("click", () => {
    calculateTransfer({trackUsage: true, saveAnalysis: true, live: false});
  });
  byId("transfer-download-analysis").addEventListener("click", downloadCurrentTransferAnalysis);
  byId("transfer-mode").addEventListener("change", updateTransferMode);
  byId("transfer-rate-source").addEventListener("change", updateTransferMode);
  byId("transfer-batch-experiment").addEventListener("change", refreshTransferBatchSamples);
  byId("transfer-batch-sample").addEventListener("change", refreshTransferBatchGases);
  byId("transfer-batch-gas").addEventListener("change", refreshTransferRateMetrics);
  byId("transfer-rate-basis").addEventListener("change", refreshTransferTimeRange);
  byId("transfer-kla-source").addEventListener("change", updateTransferControls);
  byId("transfer-vessel").addEventListener("change", updateTransferControls);
  byId("transfer-rpm").addEventListener("change", updateTransferControls);
  byId("transfer-henry-source").addEventListener("change", () => updateTransferHenryControls(true));
  byId("transfer-gas").addEventListener("change", () => {
    updateTransferHenryControls(true);
    updateTransferControls();
  });

  const liveTransferIds = [
    "transfer-rate", "transfer-rate-unit", "transfer-bottle", "transfer-liquid", "transfer-temperature",
    "transfer-pressure", "transfer-gas-value", "transfer-gas-unit", "transfer-salinity",
    "transfer-henry-source", "transfer-custom-hcp", "transfer-custom-henry-b",
    "transfer-kla-source", "transfer-vessel", "transfer-rpm", "transfer-custom-kla"
  ];
  for (const id of liveTransferIds) {
    const element = byId(id);
    if (!element) continue;
    element.addEventListener("input", scheduleTransferLiveUpdate);
    element.addEventListener("change", scheduleTransferLiveUpdate);
  }
  updateTransferMode();
  byId("batch-calculate").addEventListener("click", calculateBatch);
  byId("download-results").addEventListener("click", downloadBatchResults);
  byId("output-format").addEventListener("change", updateOutputControls);
  byId("output-scope").addEventListener("change", updateOutputControls);
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
