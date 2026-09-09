/*
 * (E)Gasboard v0.1 - batch processing
 *
 * This module mirrors reference-python/batch_processing.py as closely as is
 * practical in ordinary browser JavaScript. The user-facing measurement sheet
 * remains wide (one bottle/time point per row); calculations are internally
 * expanded to one row per gas and then reshaped back to wide output tables.
 */

import {GAS_PROPERTIES} from "./gas-properties.js";
import {
  fitLinearCalibration,
  calculateGasPercent,
  calibrationIsExtrapolated
} from "./calibration.js";
import {calculateGasState} from "./calculations.js";

export const MEASUREMENT_COLUMNS = [
  "sample_id",
  "time_h",
  "pressure_bar_abs",
  "temperature_C",
  "bottle_volume_mL",
  "liquid_volume_mL"
];

export const CALIBRATION_COLUMNS = [
  "gas_id",
  "calibration_id",
  "gas_percent",
  "peak_area"
];

export function valueIsMissing(value) {
  return value === null ||
         value === undefined ||
         value === "" ||
         (typeof value === "number" && Number.isNaN(value));
}

function uniqueInOrder(values) {
  const output = [];
  for (const value of values) {
    if (!output.includes(value)) output.push(value);
  }
  return output;
}

export function checkRequiredColumns(rows, requiredColumns, tableName) {
  const columns = rows.length ? Object.keys(rows[0]) : [];
  const missing = requiredColumns.filter(column => !columns.includes(column));

  if (missing.length) {
    throw new Error(`${tableName} is missing these required columns: ${missing.join(", ")}`);
  }
}

export function getMeasurementGasColumns(measurementRows) {
  if (!measurementRows.length) return [];
  const columns = Object.keys(measurementRows[0]);
  const gases = [];

  for (const gasId of Object.keys(GAS_PROPERTIES)) {
    if (!columns.includes(gasId)) continue;
    if (measurementRows.some(row => !valueIsMissing(row[gasId]))) {
      gases.push(gasId);
    }
  }

  return gases;
}

export function summarizeInputValidation(calibrationRows, measurementRows) {
  const checks = [];
  const calibrationColumns = calibrationRows.length ? Object.keys(calibrationRows[0]) : [];
  const measurementColumns = measurementRows.length ? Object.keys(measurementRows[0]) : [];

  const missingCalibration = CALIBRATION_COLUMNS.filter(
    column => !calibrationColumns.includes(column)
  );
  const missingMeasurement = MEASUREMENT_COLUMNS.filter(
    column => !measurementColumns.includes(column)
  );

  if (missingCalibration.length) {
    checks.push(["ERROR", `Calibration file is missing: ${missingCalibration.join(", ")}`]);
  }
  if (missingMeasurement.length) {
    checks.push(["ERROR", `Measurement file is missing: ${missingMeasurement.join(", ")}`]);
  }

  const gasColumns = getMeasurementGasColumns(measurementRows);
  if (!gasColumns.length) {
    checks.push(["ERROR", "No recognized gas peak-area columns were found in the measurement file."]);
  }

  if (calibrationColumns.includes("gas_id") && gasColumns.length) {
    const calibrationGases = new Set(
      calibrationRows
        .map(row => row.gas_id)
        .filter(value => !valueIsMissing(value))
        .map(value => String(value).trim().toUpperCase())
    );

    const noCalibration = gasColumns.filter(gas => !calibrationGases.has(gas));
    if (noCalibration.length) {
      checks.push(["ERROR", `No calibration supplied for: ${noCalibration.sort().join(", ")}`]);
    }
  }

  const duplicateColumns = measurementColumns.includes("experiment_id")
    ? ["experiment_id", "sample_id", "time_h"]
    : ["sample_id", "time_h"];

  if (duplicateColumns.every(column => measurementColumns.includes(column))) {
    const keyCounts = new Map();
    for (const row of measurementRows) {
      const key = duplicateColumns.map(column => String(row[column] ?? "")).join("\u0001");
      keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
    }

    let duplicateCount = 0;
    for (const row of measurementRows) {
      const key = duplicateColumns.map(column => String(row[column] ?? "")).join("\u0001");
      if ((keyCounts.get(key) || 0) > 1) duplicateCount += 1;
    }

    if (duplicateCount > 0) {
      checks.push([
        "CHECK",
        `${duplicateCount} row(s) share the same experiment/sample/time point. These may be intentional replicate rows.`
      ]);
    }
  }

  return checks;
}

export function fitCalibrationsFromTable(calibrationRows) {
  checkRequiredColumns(calibrationRows, CALIBRATION_COLUMNS, "Calibration file");

  const gasIds = uniqueInOrder(
    calibrationRows
      .map(row => row.gas_id)
      .filter(value => !valueIsMissing(value))
      .map(value => String(value).trim().toUpperCase())
  );

  const calibrations = {};
  const summary = [];

  for (const gasId of gasIds) {
    const gasRows = calibrationRows.filter(
      row => String(row.gas_id).trim().toUpperCase() === gasId
    );

    const calibration = fitLinearCalibration(
      gasRows.map(row => Number(row.gas_percent)),
      gasRows.map(row => Number(row.peak_area))
    );

    calibrations[gasId] = calibration;
    summary.push({
      gas_id: gasId,
      mode: calibration.mode,
      slope_area_per_percent: calibration.slope,
      intercept_area: calibration.intercept,
      r_squared: calibration.r_squared,
      number_of_points: calibration.number_of_points,
      minimum_percent: calibration.minimum_percent,
      maximum_percent: calibration.maximum_percent
    });
  }

  return {calibrations, calibration_summary: summary};
}

export function makeCalibrationFitTable(calibrationRows, gasId, calibration) {
  return calibrationRows
    .filter(row => String(row.gas_id).trim().toUpperCase() === String(gasId).trim().toUpperCase())
    .map(row => ({
      gas_percent: Number(row.gas_percent),
      peak_area: Number(row.peak_area),
      fitted_peak_area: calibration.slope * Number(row.gas_percent) + calibration.intercept
    }))
    .sort((a, b) => a.gas_percent - b.gas_percent);
}

export function measurementTableToLong(measurementRows) {
  checkRequiredColumns(measurementRows, MEASUREMENT_COLUMNS, "Measurement file");
  const gasColumns = getMeasurementGasColumns(measurementRows);

  if (!gasColumns.length) {
    throw new Error(
      "Measurement file contains no recognized gas peak-area columns. " +
      "Use gas names such as CO, CO2, CH4, O2, H2S, N2O, NO, N2 or C2H6 as column headers."
    );
  }

  const longRows = [];

  measurementRows.forEach((sourceRow, rowIndex) => {
    const experimentValue = sourceRow.experiment_id;
    const experimentId = valueIsMissing(experimentValue) || String(experimentValue).trim() === ""
      ? "Experiment 1"
      : String(experimentValue).trim();

    for (const gasId of gasColumns) {
      const peakArea = sourceRow[gasId];
      if (valueIsMissing(peakArea)) continue;

      longRows.push({
        source_excel_row: rowIndex + 2,
        experiment_id: experimentId,
        sample_id: sourceRow.sample_id,
        time_h: sourceRow.time_h,
        gas_id: gasId,
        peak_area: peakArea,
        pressure_bar_abs: sourceRow.pressure_bar_abs,
        temperature_C: sourceRow.temperature_C,
        bottle_volume_mL: sourceRow.bottle_volume_mL,
        liquid_volume_mL: sourceRow.liquid_volume_mL,
        salinity_g_L_NaCl: valueIsMissing(sourceRow.salinity_g_L_NaCl)
          ? 0.0
          : sourceRow.salinity_g_L_NaCl,
        pH: valueIsMissing(sourceRow.pH) ? null : sourceRow.pH
      });
    }
  });

  return longRows;
}

export function processMeasurementTable(measurementRows, calibrations, compressibilityFactor = 1.0) {
  const longRows = measurementTableToLong(measurementRows);

  const duplicateCounts = new Map();
  for (const row of longRows) {
    const key = [row.experiment_id, row.sample_id, row.time_h, row.gas_id].join("\u0001");
    duplicateCounts.set(key, (duplicateCounts.get(key) || 0) + 1);
  }

  const results = [];

  longRows.forEach((row, rowIndex) => {
    const gasId = String(row.gas_id).trim().toUpperCase();
    const output = {
      excel_row: row.source_excel_row ?? rowIndex + 2,
      experiment_id: row.experiment_id,
      sample_id: row.sample_id,
      time_h: row.time_h,
      gas_id: gasId,
      peak_area: row.peak_area,
      pressure_bar_abs: row.pressure_bar_abs,
      temperature_C: row.temperature_C,
      bottle_volume_mL: row.bottle_volume_mL,
      liquid_volume_mL: row.liquid_volume_mL,
      salinity_g_L_NaCl: row.salinity_g_L_NaCl,
      pH: row.pH
    };

    const qcFlags = [];
    const duplicateKey = [row.experiment_id, row.sample_id, row.time_h, gasId].join("\u0001");
    if ((duplicateCounts.get(duplicateKey) || 0) > 1) {
      qcFlags.push("DUPLICATE_MEASUREMENT");
    }

    try {
      const calibration = calibrations[gasId];
      if (!calibration) {
        throw new Error(`No calibration curve was supplied for ${gasId}.`);
      }

      const gasPercent = calculateGasPercent(row.peak_area, calibration);
      const extrapolated = calibrationIsExtrapolated(gasPercent, calibration);

      if (extrapolated) qcFlags.push("CALIBRATION_EXTRAPOLATION");
      if (gasPercent < 0) qcFlags.push("NEGATIVE_GAS_PERCENT");

      const salinity = valueIsMissing(row.salinity_g_L_NaCl)
        ? 0.0
        : Number(row.salinity_g_L_NaCl);
      const ph = valueIsMissing(row.pH) ? null : Number(row.pH);

      if ((gasId === "CO2" || gasId === "H2S") && ph === null) {
        qcFlags.push("MISSING_PH");
      }

      const result = calculateGasState({
        gas_id: gasId,
        gas_percent: gasPercent,
        pressure_bar_abs: Number(row.pressure_bar_abs),
        temperature_c: Number(row.temperature_C),
        bottle_volume_ml: Number(row.bottle_volume_mL),
        liquid_volume_ml: Number(row.liquid_volume_mL),
        ph,
        salinity_g_l_nacl: salinity,
        compressibility_factor: compressibilityFactor
      });

      for (const warning of result.warnings) {
        const lower = String(warning).toLowerCase();
        if (lower.includes("temperature") && lower.includes("range")) {
          qcFlags.push("TEMPERATURE_EXTRAPOLATION");
        }
        if (lower.includes("salting-out parameter") || lower.includes("sechenov")) {
          qcFlags.push("SALINITY_MODEL_WARNING");
        }
        if (lower.includes("no weisenberger-schumpe")) {
          qcFlags.push("SALINITY_CORRECTION_UNAVAILABLE");
        }
      }

      Object.assign(output, {
        gas_percent: gasPercent,
        calibration_extrapolated: extrapolated,
        partial_pressure_Pa: result.partial_pressure_Pa,
        henry_Hcp_mol_m3_Pa: result.henry_temperature_corrected,
        henry_pure_water_Hcp_mol_m3_Pa: result.henry_temperature_corrected_pure_water,
        salinity_NaCl_mol_L: result.salinity_NaCl_mol_L,
        sechenov_K: result.sechenov_K,
        salting_out_factor: result.salting_out_factor,
        henry_reference_Hcp_mol_m3_Pa: result.henry_reference,
        henry_B_K: result.henry_B_K,
        henry_source: result.selected_sander_entry,
        compressibility_factor_Z: compressibilityFactor,
        headspace_mmol: result.headspace_mmol,
        molecular_dissolved_mmol: result.molecular_dissolved_mmol,
        reactive_dissolved_mmol: result.reactive_dissolved_mmol,
        total_bottle_mmol: result.total_bottle_mmol,
        estimated_DIC_mmol: gasId === "CO2" && ph !== null
          ? result.estimated_DIC_mmol
          : null,
        estimated_total_sulfide_mmol: gasId === "H2S" && ph !== null
          ? result.estimated_total_sulfide_mmol
          : null,
        CO2_star_percent: null,
        HCO3_percent: null,
        CO3_percent: null,
        H2S_percent: null,
        HS_percent: null,
        S2_percent: null,
        speciation_pKa1: null,
        speciation_pKa2: null
      });

      if (result.speciation) {
        output.speciation_pKa1 = result.speciation.pK1;
        output.speciation_pKa2 = result.speciation.pK2;

        if (gasId === "CO2") {
          output.CO2_star_percent = 100.0 * result.speciation.fraction_CO2_star;
          output.HCO3_percent = 100.0 * result.speciation.fraction_HCO3;
          output.CO3_percent = 100.0 * result.speciation.fraction_CO3;
        }
        if (gasId === "H2S") {
          output.H2S_percent = 100.0 * result.speciation.fraction_H2S;
          output.HS_percent = 100.0 * result.speciation.fraction_HS;
          output.S2_percent = 100.0 * result.speciation.fraction_S2;
        }
      }

      const warningMessages = [...result.warnings];
      if (extrapolated) warningMessages.push("Calculated gas % is outside the calibration range.");
      output.warnings = warningMessages.join(" | ");
      output.processing_error = "";
    } catch (error) {
      qcFlags.push("ERROR");

      for (const key of [
        "estimated_DIC_mmol", "estimated_total_sulfide_mmol", "gas_percent",
        "calibration_extrapolated", "partial_pressure_Pa", "henry_Hcp_mol_m3_Pa",
        "henry_pure_water_Hcp_mol_m3_Pa", "salinity_NaCl_mol_L", "sechenov_K",
        "salting_out_factor", "henry_reference_Hcp_mol_m3_Pa", "henry_B_K",
        "henry_source", "CO2_star_percent", "HCO3_percent", "CO3_percent",
        "H2S_percent", "HS_percent", "S2_percent", "speciation_pKa1",
        "speciation_pKa2", "headspace_mmol",
        "molecular_dissolved_mmol", "reactive_dissolved_mmol", "total_bottle_mmol"
      ]) {
        output[key] = null;
      }
      output.compressibility_factor_Z = compressibilityFactor;
      output.warnings = "";
      output.processing_error = error.message;
    }

    output.QC_status = uniqueInOrder(qcFlags).length
      ? uniqueInOrder(qcFlags).join(" | ")
      : "OK";

    results.push(output);
  });

  return results;
}

function sourceRowsByExcelRow(results) {
  const sorted = [...results].sort((a, b) => Number(a.excel_row) - Number(b.excel_row));
  const map = new Map();
  for (const row of sorted) {
    if (!map.has(row.excel_row)) map.set(row.excel_row, row);
  }
  return [...map.values()];
}

export function makeWideResultsTable(results) {
  if (!results.length) return [];
  if (!("excel_row" in results[0]) || !("gas_id" in results[0])) return results.map(row => ({...row}));

  const shared = sourceRowsByExcelRow(results).map(row => ({
    excel_row: row.excel_row,
    experiment_id: row.experiment_id,
    sample_id: row.sample_id,
    time_h: row.time_h,
    pressure_bar_abs: row.pressure_bar_abs,
    temperature_C: row.temperature_C,
    bottle_volume_mL: row.bottle_volume_mL,
    liquid_volume_mL: row.liquid_volume_mL,
    salinity_g_L_NaCl: row.salinity_g_L_NaCl,
    pH: row.pH
  }));

  const gasOrder = uniqueInOrder(results.map(row => String(row.gas_id).trim().toUpperCase()));
  const metrics = [
    "peak_area", "gas_percent", "total_bottle_mmol", "headspace_mmol",
    "molecular_dissolved_mmol", "reactive_dissolved_mmol", "partial_pressure_Pa",
    "estimated_DIC_mmol", "estimated_total_sulfide_mmol", "CO2_star_percent",
    "HCO3_percent", "CO3_percent", "H2S_percent", "HS_percent", "S2_percent",
    "speciation_pKa1", "speciation_pKa2", "calibration_extrapolated",
    "QC_status", "warnings", "processing_error"
  ];

  for (const gasId of gasOrder) {
    const rowsForGas = results.filter(row => String(row.gas_id).trim().toUpperCase() === gasId);
    const byExcelRow = new Map(rowsForGas.map(row => [row.excel_row, row]));

    for (const metric of metrics) {
      const hasAny = rowsForGas.some(row => !valueIsMissing(row[metric]));
      if (!hasAny) continue;

      for (const outputRow of shared) {
        const gasRow = byExcelRow.get(outputRow.excel_row);
        outputRow[`${gasId}_${metric}`] = gasRow ? (gasRow[metric] ?? null) : null;
      }
    }
  }

  return shared.map(({excel_row, ...row}) => row);
}

export function makeCompactResultsTable(results) {
  if (!results.length) return [];
  if (!("excel_row" in results[0]) || !("gas_id" in results[0])) return results.map(row => ({...row}));

  const compact = sourceRowsByExcelRow(results).map(row => ({
    excel_row: row.excel_row,
    experiment_id: row.experiment_id,
    sample_id: row.sample_id,
    time_h: row.time_h,
    pressure_bar_abs: row.pressure_bar_abs,
    temperature_C: row.temperature_C,
    bottle_volume_mL: row.bottle_volume_mL,
    liquid_volume_mL: row.liquid_volume_mL,
    salinity_g_L_NaCl: row.salinity_g_L_NaCl,
    pH: row.pH
  }));

  const gasOrder = uniqueInOrder(results.map(row => String(row.gas_id).trim().toUpperCase()));

  for (const gasId of gasOrder) {
    const rowsForGas = results.filter(row => String(row.gas_id).trim().toUpperCase() === gasId);
    const byExcelRow = new Map(rowsForGas.map(row => [row.excel_row, row]));

    for (const outputRow of compact) {
      const row = byExcelRow.get(outputRow.excel_row);
      if (!row) continue;

      outputRow[`${gasId}_gas_percent`] = row.gas_percent ?? null;
      outputRow[`${gasId}_total_mmol`] = row.total_bottle_mmol ?? null;
      outputRow[`${gasId}_headspace_mmol`] = row.headspace_mmol ?? null;
      outputRow[`${gasId}_liquid_mmol`] = row.molecular_dissolved_mmol ?? null;
      outputRow[`${gasId}_partial_pressure_bar`] = valueIsMissing(row.partial_pressure_Pa)
        ? null
        : Number(row.partial_pressure_Pa) / 100000.0;

      if (gasId === "CO2") {
        if (!valueIsMissing(row.estimated_DIC_mmol)) {
          outputRow.CO2_estimated_DIC_mmol = row.estimated_DIC_mmol;
        }
      }

      if (gasId === "H2S") {
        if (!valueIsMissing(row.estimated_total_sulfide_mmol)) {
          outputRow.H2S_estimated_total_sulfide_mmol = row.estimated_total_sulfide_mmol;
        }
        for (const metric of ["H2S_percent", "HS_percent", "S2_percent"]) {
          if (!valueIsMissing(row[metric])) outputRow[`H2S_${metric}`] = row[metric];
        }
      }
    }
  }

  return compact.map(({excel_row, ...row}) => row);
}
