import fs from "node:fs";
import assert from "node:assert/strict";

import {fitLinearCalibration} from "../js/calibration.js";
import {calculateGasState, calculateRequiredGasAddition} from "../js/calculations.js";
import {calculateNaclSalinityCorrection} from "../js/salinity.js";
import {
  fitCalibrationsFromTable,
  processMeasurementTable,
  applySamplingCorrections,
  makeCompactResultsTable
} from "../js/batch-processing.js";

const fixture = JSON.parse(
  fs.readFileSync(new URL("./parity-fixtures.json", import.meta.url), "utf8")
);

function close(actual, expected, tolerance = 1e-10, label = "value") {
  if (actual === null || expected === null) {
    assert.equal(actual, expected, label);
    return;
  }

  const scale = Math.max(1, Math.abs(expected));
  const difference = Math.abs(actual - expected);
  assert.ok(
    difference <= tolerance * scale,
    `${label}: ${actual} != ${expected} (difference ${difference})`
  );
}

function compareNumericKeys(actual, expected, keys, tolerance = 1e-10, prefix = "") {
  for (const key of keys) {
    close(Number(actual[key]), Number(expected[key]), tolerance, `${prefix}${key}`);
  }
}

// Calibration, including the non-negative intercept rule.
{
  const x = [0, 0.93541, 0.93541, 2.32941, 2.32941, 4.51637, 4.51637, 8.69414, 8.69414];
  const y = [0, 100.6, 100.5, 264, 265.4, 530, 523.6, 1054.1, 1056.7];
  const actual = fitLinearCalibration(x, y);
  const expected = fixture.calibration_negative_intercept;

  compareNumericKeys(actual, expected, ["slope", "intercept", "r_squared"], 1e-12, "calibration.");
  assert.equal(actual.mode, expected.mode);
}

// Single CO state.
{
  const actual = calculateGasState({
    gas_id: "CO",
    gas_percent: 4.5,
    pressure_bar_abs: 1.5,
    temperature_c: 23,
    bottle_volume_ml: 120,
    liquid_volume_ml: 40,
    ph: null,
    salinity_g_l_nacl: 0,
    compressibility_factor: 1
  });

  const expected = fixture.single_co;
  compareNumericKeys(actual, expected, [
    "partial_pressure_Pa",
    "henry_temperature_corrected_pure_water",
    "henry_temperature_corrected",
    "headspace_mmol",
    "molecular_dissolved_mmol",
    "total_bottle_mmol"
  ], 1e-12, "single_co.");
}

// CO2: physical bottle total stays separate from estimated DIC.
{
  const actual = calculateGasState({
    gas_id: "CO2",
    gas_percent: 2.5,
    pressure_bar_abs: 1.2,
    temperature_c: 30,
    bottle_volume_ml: 120,
    liquid_volume_ml: 60,
    ph: 7.2,
    salinity_g_l_nacl: 5,
    compressibility_factor: 1
  });

  const expected = fixture.single_co2;
  compareNumericKeys(actual, expected, [
    "headspace_mmol",
    "molecular_dissolved_mmol",
    "total_bottle_mmol",
    "estimated_DIC_mmol",
    "salting_out_factor"
  ], 1e-11, "single_co2.");

  close(
    actual.total_bottle_mmol,
    actual.headspace_mmol + actual.molecular_dissolved_mmol,
    1e-12,
    "CO2 physical total"
  );
  assert.ok(actual.estimated_DIC_mmol > actual.molecular_dissolved_mmol);
}

// H2S: physical total and total sulfide are separate.
{
  const actual = calculateGasState({
    gas_id: "H2S",
    gas_percent: 1.0,
    pressure_bar_abs: 1.0,
    temperature_c: 25,
    bottle_volume_ml: 120,
    liquid_volume_ml: 60,
    ph: 7.0,
    salinity_g_l_nacl: 0,
    compressibility_factor: 1
  });

  close(
    actual.total_bottle_mmol,
    actual.headspace_mmol + actual.molecular_dissolved_mmol,
    1e-12,
    "H2S physical total"
  );
  assert.ok(actual.estimated_total_sulfide_mmol > actual.molecular_dissolved_mmol);
}

// Salting out lowers Hcp when a parameter is available.
{
  const result = calculateNaclSalinityCorrection("O2", 298.15, 33.0);
  assert.ok(result.salting_out_factor > 1.0);
  assert.equal(result.correction_available, true);

  const co = calculateNaclSalinityCorrection("CO", 298.15, 33.0);
  assert.equal(co.correction_available, false);
  assert.ok(String(co.warning).includes("no Weisenberger-Schumpe"));
}

// O2 dosing parity.
{
  const actual = calculateRequiredGasAddition({
    gas_id: "O2",
    target_dissolved_umol_l: 150,
    target_basis: "molecular",
    bottle_volume_ml: 120,
    liquid_volume_ml: 100,
    temperature_c: 25,
    salinity_g_l_nacl: 33,
    ph: null,
    initial_gas_percent: 0,
    initial_pressure_bar_abs: 1.01325,
    dose_gas_percent: 100,
    dose_pressure_bar_abs: 1.01325,
    compressibility_factor: 1
  });

  const expected = fixture.dose_o2;
  compareNumericKeys(actual, expected, [
    "target_molecular_dissolved_mmol",
    "target_headspace_mmol",
    "required_target_gas_mmol",
    "required_dose_mix_volume_mL",
    "required_partial_pressure_bar"
  ], 1e-11, "dose_o2.");
}

// Reactive dosing supports either molecular gas or the total dissolved pool.
{
  const molecular = calculateRequiredGasAddition({
    gas_id: "CO2",
    target_dissolved_umol_l: 100,
    target_basis: "molecular",
    bottle_volume_ml: 120,
    liquid_volume_ml: 60,
    temperature_c: 25,
    salinity_g_l_nacl: 0,
    ph: 7.0,
    initial_gas_percent: 0,
    initial_pressure_bar_abs: 1.0,
    dose_gas_percent: 100,
    dose_pressure_bar_abs: 1.0
  });

  const pool = calculateRequiredGasAddition({
    gas_id: "CO2",
    target_dissolved_umol_l: 100,
    target_basis: "total_pool",
    bottle_volume_ml: 120,
    liquid_volume_ml: 60,
    temperature_c: 25,
    salinity_g_l_nacl: 0,
    ph: 7.0,
    initial_gas_percent: 0,
    initial_pressure_bar_abs: 1.0,
    dose_gas_percent: 100,
    dose_pressure_bar_abs: 1.0
  });

  assert.equal(molecular.target_basis, "molecular");
  assert.equal(pool.target_basis, "total_pool");
  assert.ok(pool.required_partial_pressure_bar < molecular.required_partial_pressure_bar);
}

// A target already reached returns zero addition, not a negative dose.
{
  const result = calculateRequiredGasAddition({
    gas_id: "O2",
    target_dissolved_umol_l: 10,
    target_basis: "molecular",
    bottle_volume_ml: 120,
    liquid_volume_ml: 100,
    temperature_c: 25,
    salinity_g_l_nacl: 0,
    initial_gas_percent: 21,
    initial_pressure_bar_abs: 1.0,
    dose_gas_percent: 100,
    dose_pressure_bar_abs: 1.0
  });

  assert.equal(result.required_target_gas_mmol, 0);
  assert.equal(result.required_dose_mix_volume_mL, 0);
}

// Example batch parity against the Python reference.
{
  const fit = fitCalibrationsFromTable(fixture.calibration_rows);
  let results = processMeasurementTable(fixture.measurement_rows, fit.calibrations, 1.0);
  results = applySamplingCorrections(results, fixture.measurement_rows);
  const compact = makeCompactResultsTable(results);

  const expectedSummary = fixture.example_batch.calibration_summary;
  assert.equal(fit.calibration_summary.length, expectedSummary.length);

  for (let i = 0; i < expectedSummary.length; i += 1) {
    assert.equal(fit.calibration_summary[i].gas_id, expectedSummary[i].gas_id);
    compareNumericKeys(fit.calibration_summary[i], expectedSummary[i], [
      "slope_area_per_percent",
      "intercept_area",
      "r_squared",
      "minimum_percent",
      "maximum_percent"
    ], 1e-11, `batch.calibration.${i}.`);
  }

  const expectedResults = fixture.example_batch.first_results;
  for (let i = 0; i < expectedResults.length; i += 1) {
    assert.equal(results[i].gas_id, expectedResults[i].gas_id);
    compareNumericKeys(results[i], expectedResults[i], [
      "gas_percent",
      "partial_pressure_Pa",
      "headspace_mmol",
      "molecular_dissolved_mmol",
      "total_bottle_mmol"
    ], 1e-10, `batch.result.${i}.`);
  }

  const expectedCompact = fixture.example_batch.first_compact;
  assert.ok(compact.length >= expectedCompact.length);
  for (let i = 0; i < expectedCompact.length; i += 1) {
    assert.equal(String(compact[i].sample_id), String(expectedCompact[i].sample_id));
    for (const [key, expectedValue] of Object.entries(expectedCompact[i])) {
      if (typeof expectedValue === "number") {
        close(Number(compact[i][key]), expectedValue, 1e-10, `compact.${i}.${key}`);
      }
    }
  }
}


// Longitudinal sampling correction: a sample taken after row 1 affects row 2 only.
{
  const calibrationRows = [
    {gas_id: "CO", calibration_id: "CO_0", gas_percent: 0, peak_area: 0},
    {gas_id: "CO", calibration_id: "CO_10", gas_percent: 10, peak_area: 1000}
  ];
  const measurementRows = [
    {
      experiment_id: "Sampling_test",
      sample_id: "Bottle_01",
      time_h: 0,
      pressure_bar_abs: 1.0,
      temperature_C: 25,
      bottle_volume_mL: 120,
      liquid_volume_mL: 50,
      liquid_sample_mL: 1.0,
      headspace_sample_mL: 0.1,
      CO: 500
    },
    {
      experiment_id: "Sampling_test",
      sample_id: "Bottle_01",
      time_h: 1,
      pressure_bar_abs: 1.0,
      temperature_C: 25,
      bottle_volume_mL: 120,
      liquid_volume_mL: 49,
      liquid_sample_mL: 0,
      headspace_sample_mL: 0,
      CO: 500
    }
  ];

  const fit = fitCalibrationsFromTable(calibrationRows);
  let results = processMeasurementTable(measurementRows, fit.calibrations, 1.0);
  results = applySamplingCorrections(results, measurementRows);

  const first = results[0];
  const second = results[1];
  const expectedFirstSampled =
    first.headspace_mmol * 0.1 / (120 - 50) +
    first.molecular_dissolved_mmol * 1.0 / 50;

  close(first.cumulative_sampled_molecular_mmol, 0, 1e-12, "sampling.first.cumulative");
  close(first.sampling_corrected_total_mmol, first.total_bottle_mmol, 1e-12, "sampling.first.corrected");
  close(first.sampled_total_molecular_mmol, expectedFirstSampled, 1e-12, "sampling.first.removed");
  close(second.cumulative_sampled_molecular_mmol, expectedFirstSampled, 1e-12, "sampling.second.cumulative");
  close(
    second.sampling_corrected_total_mmol,
    second.total_bottle_mmol + expectedFirstSampled,
    1e-12,
    "sampling.second.corrected"
  );
}

console.log("Static JavaScript scientific parity tests passed.");
