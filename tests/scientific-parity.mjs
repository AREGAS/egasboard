import fs from "node:fs";
import assert from "node:assert/strict";

import {fitLinearCalibration} from "../js/calibration.js";
import {calculateGasState, calculateRequiredGasAddition} from "../js/calculations.js";
import {calculateNaclSalinityCorrection} from "../js/salinity.js";
import {
  calculateMassTransferAssessment,
  getKlaScreeningEstimate
} from "../js/mass-transfer.js";
import {
  fitCalibrationsFromTable,
  processMeasurementTable,
  applySamplingCorrections,
  makeCompactResultsTable
} from "../js/batch-processing.js";
import {fitTimeSeriesRate} from "../js/rate-analysis.js";

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

// Headspace-target dosing reaches the requested equilibrated ppmv target.
{
  const result = calculateRequiredGasAddition({
    gas_id: "CO",
    target_mode: "headspace",
    target_headspace_percent: 0.05,
    target_dissolved_umol_l: null,
    target_basis: "molecular",
    bottle_volume_ml: 120,
    liquid_volume_ml: 100,
    temperature_c: 25,
    salinity_g_l_nacl: 0,
    ph: null,
    initial_gas_percent: 0,
    initial_pressure_bar_abs: 1.01325,
    dose_gas_percent: 100,
    dose_pressure_bar_abs: 1.01325,
    compressibility_factor: 1
  });

  close(result.final_headspace_ppmv, 500, 1e-9, "headspace target ppmv");
  close(result.final_headspace_percent, 0.05, 1e-12, "headspace target percent");
  assert.ok(result.required_dose_mix_volume_mL > 0);
}

// A dosing mixture that is too dilute for the requested equilibrium target is rejected.
{
  assert.throws(() => calculateRequiredGasAddition({
    gas_id: "CO",
    target_mode: "headspace",
    target_headspace_percent: 0.05,
    target_dissolved_umol_l: null,
    target_basis: "molecular",
    bottle_volume_ml: 120,
    liquid_volume_ml: 100,
    temperature_c: 25,
    salinity_g_l_nacl: 0,
    ph: null,
    initial_gas_percent: 0,
    initial_pressure_bar_abs: 1.01325,
    dose_gas_percent: 0.05,
    dose_pressure_bar_abs: 1.01325,
    compressibility_factor: 1
  }), /cannot be reached/);
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

  assert.ok(compact.length > 0);
  assert.ok("CO_percent" in compact[0]);
  assert.ok("CO_total_mmol" in compact[0]);
  assert.ok("CO_headspace_mmol" in compact[0]);
  assert.ok("CO_liquid_mmol" in compact[0]);
  assert.ok(!("CO_partial_pressure_bar" in compact[0]));
  assert.ok(!("salinity_g_L_NaCl" in compact[0]));
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
// kLa screening table and mass-transfer equation.
{
  const estimate = getKlaScreeningEstimate("small_bottle", 200);
  close(estimate.central_kla_h, 15, 1e-12, "kLa central");
  close(estimate.low_kla_h, 7.5, 1e-12, "kLa low");
  close(estimate.high_kla_h, 22.5, 1e-12, "kLa high");

  const result = calculateMassTransferAssessment({
    gas_id: "CO",
    observed_rate_value: 0.20,
    observed_rate_unit: "mmol_d",
    liquid_volume_ml: 40,
    temperature_c: 30,
    pressure_bar_abs: 1.01325,
    headspace_gas_percent: 10,
    salinity_g_l_nacl: 0,
    kla_source: "custom",
    custom_kla_h: 10
  });

  const expectedCapacity =
    10 * 0.040 * result.equilibrium_dissolved_mmol_L * 24;

  close(
    result.transfer_capacity_central_mmol_d,
    expectedCapacity,
    1e-12,
    "mass transfer capacity"
  );
  close(
    result.transfer_demand_ratio_central,
    0.20 / expectedCapacity,
    1e-12,
    "mass transfer demand"
  );
  const customHenry = calculateMassTransferAssessment({
    gas_id: "CO",
    observed_rate_value: 0.20,
    observed_rate_unit: "mmol_d",
    liquid_volume_ml: 40,
    temperature_c: 30,
    pressure_bar_abs: 1.01325,
    headspace_gas_percent: 10,
    salinity_g_l_nacl: 0,
    kla_source: "custom",
    custom_kla_h: 10,
    henry_source: "custom",
    custom_hcp_ref: 1.0e-5,
    custom_henry_B_K: 1200
  });

  close(customHenry.henry_reference_Hcp_mol_m3_Pa, 1.0e-5, 1e-15, "custom Hcp reference");
  close(customHenry.henry_B_K, 1200, 1e-12, "custom Henry B");
  if (!customHenry.henry_overridden) {
    throw new Error("Custom Henry override was not recorded.");
  }

}


// Time-series rate fitting preserves the sign and reports uptake magnitude.
{
  const rows = [
    {time_h: 0, total_bottle_mmol: 1.0, liquid_volume_mL: 40, temperature_C: 30, pressure_bar_abs: 1.0, gas_percent: 10, salinity_g_L_NaCl: 0},
    {time_h: 2, total_bottle_mmol: 0.8, liquid_volume_mL: 40, temperature_C: 30, pressure_bar_abs: 1.0, gas_percent: 9, salinity_g_L_NaCl: 0},
    {time_h: 4, total_bottle_mmol: 0.6, liquid_volume_mL: 40, temperature_C: 30, pressure_bar_abs: 1.0, gas_percent: 8, salinity_g_L_NaCl: 0}
  ];
  const fit = fitTimeSeriesRate({rows, metric: "total_bottle_mmol", time_start_h: 0, time_end_h: 4});
  close(fit.slope_mmol_h, -0.1, 1e-12, "rate slope");
  close(fit.signed_rate_mmol_d, -2.4, 1e-12, "signed daily rate");
  close(fit.uptake_rate_mmol_d, 2.4, 1e-12, "uptake daily rate");
  close(fit.r_squared, 1.0, 1e-12, "rate r2");
  assert.equal(fit.direction, "uptake");
}

// Current small-bottle screening estimate used by the UI.
{
  const estimate = getKlaScreeningEstimate("small_bottle", 150, "CO");
  close(estimate.central_kla_h, 10, 1e-12, "small bottle 150 rpm kLa");
  close(estimate.low_kla_h, 5, 1e-12, "small bottle low kLa");
  close(estimate.high_kla_h, 15, 1e-12, "small bottle high kLa");
}
