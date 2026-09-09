/*
 * (E)Gasboard v0.1 - core gas calculations
 *
 * This module is intentionally verbose and mirrors the Python reference
 * implementation. Scientific calculations are not hidden in the UI code.
 *
 * Workflow for one measured bottle state:
 *
 *   1. Convert entered units to SI.
 *   2. Convert gas % to mole fraction.
 *   3. Calculate gas partial pressure.
 *   4. Temperature-correct Henry Hcp.
 *   5. Apply optional NaCl salting-out correction.
 *   6. Calculate headspace moles from pV = ZnRT.
 *   7. Calculate neutral dissolved gas from c = Hcp * p.
 *   8. Optionally estimate CO2/H2S acid-base pools.
 *   9. Add headspace and molecular dissolved gas for the physical bottle total.
 */

import {
  calculateHenryConstant,
  checkTemperatureRange,
  getGasProperty
} from "./gas-properties.js";

import {
  calculateCo2Speciation,
  calculateH2sSpeciation
} from "./speciation.js";

import {
  calculateNaclSalinityCorrection,
  applySalinityToHenry
} from "./salinity.js";

export const R = 8.314462618; // J mol^-1 K^-1
export const BAR_TO_PA = 100000.0;
export const ML_TO_M3 = 0.000001;
export const MOL_TO_MMOL = 1000.0;

export function calculateGasState({
  gas_id,
  gas_percent,
  pressure_bar_abs,
  temperature_c,
  bottle_volume_ml,
  liquid_volume_ml,
  ph = null,
  salinity_g_l_nacl = 0.0,
  compressibility_factor = 1.0
}) {
  const gasId = String(gas_id).trim().toUpperCase();
  const gasPercent = Number(gas_percent);
  const pressureBarAbs = Number(pressure_bar_abs);
  const temperatureC = Number(temperature_c);
  const bottleVolumeMl = Number(bottle_volume_ml);
  const liquidVolumeMl = Number(liquid_volume_ml);
  const salinity = Number(salinity_g_l_nacl ?? 0.0);
  const Z = Number(compressibility_factor);

  // ---------------------------------------------------------------
  // STEP 0 - input checks
  // ---------------------------------------------------------------
  if (gasPercent < 0 || gasPercent > 100) {
    throw new Error("Gas percentage must be between 0 and 100.");
  }
  if (!(pressureBarAbs > 0)) {
    throw new Error("Absolute pressure must be larger than zero.");
  }
  if (!(bottleVolumeMl > 0)) {
    throw new Error("Bottle volume must be larger than zero.");
  }
  if (liquidVolumeMl < 0 || liquidVolumeMl >= bottleVolumeMl) {
    throw new Error("Liquid volume must be at least 0 mL and smaller than bottle volume.");
  }
  if (!(temperatureC > -273.15)) {
    throw new Error("Temperature must be above absolute zero.");
  }
  if (!(Z > 0)) {
    throw new Error("Compressibility factor Z must be larger than zero.");
  }
  if (salinity < 0) {
    throw new Error("NaCl-equivalent concentration cannot be negative.");
  }

  const gas = getGasProperty(gasId);

  // ---------------------------------------------------------------
  // STEP 1 - SI conversion
  // ---------------------------------------------------------------
  const temperatureK = temperatureC + 273.15;
  const totalPressurePa = pressureBarAbs * BAR_TO_PA;
  const headspaceVolumeMl = bottleVolumeMl - liquidVolumeMl;
  const headspaceVolumeM3 = headspaceVolumeMl * ML_TO_M3;
  const liquidVolumeM3 = liquidVolumeMl * ML_TO_M3;

  // ---------------------------------------------------------------
  // STEP 2 - gas fraction
  // ---------------------------------------------------------------
  const gasFraction = gasPercent / 100.0;

  // ---------------------------------------------------------------
  // STEP 3 - gas partial pressure
  // ---------------------------------------------------------------
  // v0.1 treats the entered pressure as pressure of the dry gas mixture.
  const partialPressurePa = gasFraction * totalPressurePa;

  // ---------------------------------------------------------------
  // STEP 4 - Henry Hcp at the entered temperature
  // ---------------------------------------------------------------
  const henryPureWater = calculateHenryConstant(gasId, temperatureK);

  // ---------------------------------------------------------------
  // STEP 4B - optional NaCl correction
  // ---------------------------------------------------------------
  const salinityResult = calculateNaclSalinityCorrection(
    gasId,
    temperatureK,
    salinity
  );

  const henryConstant = applySalinityToHenry(
    henryPureWater,
    salinityResult.salting_out_factor
  );

  // ---------------------------------------------------------------
  // STEP 5 - headspace amount: n = pV / (ZRT)
  // ---------------------------------------------------------------
  const headspaceMoles =
    (partialPressurePa * headspaceVolumeM3) /
    (Z * R * temperatureK);

  const headspaceMmol = headspaceMoles * MOL_TO_MMOL;

  // ---------------------------------------------------------------
  // STEP 6 - neutral dissolved gas: c = Hcp * p
  // ---------------------------------------------------------------
  const neutralConcentrationMolM3 = henryConstant * partialPressurePa;
  const neutralDissolvedMoles = neutralConcentrationMolM3 * liquidVolumeM3;
  const neutralDissolvedMmol = neutralDissolvedMoles * MOL_TO_MMOL;

  let reactiveDissolvedMoles = neutralDissolvedMoles;
  let speciationResults = null;

  // ---------------------------------------------------------------
  // STEP 7 - optional reactive dissolved pools
  // ---------------------------------------------------------------
  // These pools are reported separately. They do not change the meaning
  // of total_bottle_mmol, which is always physical gas:
  // headspace + molecular dissolved gas.
  if (gasId === "CO2" && ph !== null && ph !== undefined && ph !== "") {
    speciationResults = calculateCo2Speciation(Number(ph), temperatureK);
    reactiveDissolvedMoles =
      neutralDissolvedMoles * speciationResults.reactive_factor;
    speciationResults.total_DIC_concentration_mol_m3 =
      neutralConcentrationMolM3 * speciationResults.reactive_factor;
  }

  if (gasId === "H2S" && ph !== null && ph !== undefined && ph !== "") {
    speciationResults = calculateH2sSpeciation(Number(ph), temperatureK);
    reactiveDissolvedMoles =
      neutralDissolvedMoles * speciationResults.reactive_factor;
    speciationResults.total_sulfide_concentration_mol_m3 =
      neutralConcentrationMolM3 * speciationResults.reactive_factor;
  }

  const reactiveDissolvedMmol = reactiveDissolvedMoles * MOL_TO_MMOL;

  // ---------------------------------------------------------------
  // STEP 8 - physical bottle amount
  // ---------------------------------------------------------------
  const totalBottleMoles = headspaceMoles + neutralDissolvedMoles;
  const totalBottleMmol = totalBottleMoles * MOL_TO_MMOL;

  // ---------------------------------------------------------------
  // STEP 9 - warnings
  // ---------------------------------------------------------------
  const warnings = [];

  const temperatureWarning = checkTemperatureRange(gasId, temperatureK);
  if (temperatureWarning) warnings.push(temperatureWarning);

  if ((gasId === "CO2" || gasId === "H2S") &&
      (ph === null || ph === undefined || ph === "")) {
    warnings.push(`${gasId}: no pH supplied. pH-dependent speciation is not calculated.`);
  }

  if (salinityResult.warning) warnings.push(salinityResult.warning);
  if (speciationResults && speciationResults.warning) {
    warnings.push(speciationResults.warning);
  }

  const result = {
    gas_id: gasId,
    gas_name: gas.gas_name,
    temperature_K: temperatureK,
    pressure_Pa_abs: totalPressurePa,
    gas_fraction: gasFraction,
    partial_pressure_Pa: partialPressurePa,
    headspace_volume_mL: headspaceVolumeMl,
    headspace_volume_m3: headspaceVolumeM3,
    liquid_volume_m3: liquidVolumeM3,
    henry_reference: gas.hcp_ref,
    henry_temperature_corrected_pure_water: henryPureWater,
    henry_temperature_corrected: henryConstant,
    salinity_g_L_NaCl: salinity,
    salinity_NaCl_mol_L: salinityResult.nacl_mol_L,
    salinity_correction_available: salinityResult.correction_available,
    sechenov_K: salinityResult.sechenov_K,
    salting_out_factor: salinityResult.salting_out_factor,
    henry_B_K: gas.B_K,
    selected_sander_entry: gas.selected_sander_entry,
    headspace_mmol: headspaceMmol,
    neutral_dissolved_concentration_mol_m3: neutralConcentrationMolM3,
    molecular_dissolved_mmol: neutralDissolvedMmol,
    reactive_dissolved_mmol: reactiveDissolvedMmol,
    total_bottle_mmol: totalBottleMmol,
    speciation: speciationResults,
    warnings
  };

  if (gasId === "CO2") {
    result.estimated_DIC_mmol =
      (ph === null || ph === undefined || ph === "")
        ? null
        : reactiveDissolvedMmol;
  }

  if (gasId === "H2S") {
    result.estimated_total_sulfide_mmol =
      (ph === null || ph === undefined || ph === "")
        ? null
        : reactiveDissolvedMmol;
  }

  return result;
}

export function calculateRequiredGasAddition({
  gas_id,
  target_dissolved_umol_l,
  target_basis = "molecular",
  bottle_volume_ml,
  liquid_volume_ml,
  temperature_c,
  salinity_g_l_nacl = 0.0,
  ph = null,
  initial_gas_percent = 0.0,
  initial_pressure_bar_abs = 1.01325,
  dose_gas_percent = 100.0,
  dose_pressure_bar_abs = 1.01325,
  compressibility_factor = 1.0
}) {
  const gasId = String(gas_id).trim().toUpperCase();
  const targetUmolL = Number(target_dissolved_umol_l);
  const targetBasis = String(target_basis || "molecular").trim().toLowerCase();
  const bottleVolumeMl = Number(bottle_volume_ml);
  const liquidVolumeMl = Number(liquid_volume_ml);
  const temperatureC = Number(temperature_c);
  const salinity = Number(salinity_g_l_nacl ?? 0.0);
  const doseGasPercent = Number(dose_gas_percent);
  const dosePressureBarAbs = Number(dose_pressure_bar_abs);
  const Z = Number(compressibility_factor);

  if (targetUmolL < 0) {
    throw new Error("Target dissolved concentration cannot be negative.");
  }
  if (!["molecular", "total_pool"].includes(targetBasis)) {
    throw new Error("Target basis must be molecular or total_pool.");
  }
  if (targetBasis === "total_pool" && !["CO2", "H2S"].includes(gasId)) {
    throw new Error("Total dissolved pool is only available for CO2 and H2S.");
  }
  if (!(doseGasPercent > 0) || doseGasPercent > 100) {
    throw new Error("Dosing-gas percentage must be above 0 and at most 100%.");
  }
  if (!(dosePressureBarAbs > 0)) {
    throw new Error("Dosing-gas pressure must be larger than zero.");
  }
  if (!(bottleVolumeMl > 0)) {
    throw new Error("Bottle volume must be larger than zero.");
  }
  if (liquidVolumeMl < 0 || liquidVolumeMl >= bottleVolumeMl) {
    throw new Error("Liquid volume must be at least 0 mL and smaller than bottle volume.");
  }

  const temperatureK = temperatureC + 273.15;
  const headspaceVolumeM3 = (bottleVolumeMl - liquidVolumeMl) * ML_TO_M3;
  const liquidVolumeM3 = liquidVolumeMl * ML_TO_M3;

  // 1 µmol/L = 0.001 mol/m3.
  const targetDissolvedMolM3 = targetUmolL * 0.001;

  const henryPureWater = calculateHenryConstant(gasId, temperatureK);
  const salinityResult = calculateNaclSalinityCorrection(
    gasId,
    temperatureK,
    salinity
  );
  const henryConstant = applySalinityToHenry(
    henryPureWater,
    salinityResult.salting_out_factor
  );

  let reactiveFactor = 1.0;
  let speciation = null;

  if (gasId === "CO2" && ph !== null && ph !== undefined && ph !== "") {
    speciation = calculateCo2Speciation(Number(ph), temperatureK);
    reactiveFactor = speciation.reactive_factor;
  }
  if (gasId === "H2S" && ph !== null && ph !== undefined && ph !== "") {
    speciation = calculateH2sSpeciation(Number(ph), temperatureK);
    reactiveFactor = speciation.reactive_factor;
  }

  if (targetBasis === "total_pool" && !speciation) {
    throw new Error("pH is required when the target is DIC or total sulfide.");
  }

  // Molecular target: target concentration means CO2*, H2S or the selected gas.
  // Total-pool target: target concentration means DIC or total dissolved sulfide.
  const effectiveHenry = targetBasis === "total_pool"
    ? henryConstant * reactiveFactor
    : henryConstant;

  if (!(effectiveHenry > 0)) {
    throw new Error("Effective Henry solubility must be larger than zero.");
  }

  const requiredPartialPressurePa = targetDissolvedMolM3 / effectiveHenry;
  const targetMolecularConcentrationMolM3 =
    henryConstant * requiredPartialPressurePa;
  const targetPoolConcentrationMolM3 =
    targetMolecularConcentrationMolM3 * reactiveFactor;

  const targetHeadspaceMoles =
    (requiredPartialPressurePa * headspaceVolumeM3) /
    (Z * R * temperatureK);

  const targetMolecularDissolvedMoles =
    targetMolecularConcentrationMolM3 * liquidVolumeM3;
  const targetReactivePoolMoles =
    targetPoolConcentrationMolM3 * liquidVolumeM3;

  // For reactive gases, added gas can end up as acid/base species. The amount
  // that must be added is therefore based on the full gas-derived pool.
  const targetGasDerivedBottleMoles =
    targetHeadspaceMoles + targetReactivePoolMoles;

  const targetHeadspaceMmol = targetHeadspaceMoles * MOL_TO_MMOL;
  const targetMolecularDissolvedMmol = targetMolecularDissolvedMoles * MOL_TO_MMOL;
  const targetReactivePoolMmol = targetReactivePoolMoles * MOL_TO_MMOL;
  const targetGasDerivedBottleMmol = targetGasDerivedBottleMoles * MOL_TO_MMOL;

  const initialState = calculateGasState({
    gas_id: gasId,
    gas_percent: Number(initial_gas_percent),
    pressure_bar_abs: Number(initial_pressure_bar_abs),
    temperature_c: temperatureC,
    bottle_volume_ml: bottleVolumeMl,
    liquid_volume_ml: liquidVolumeMl,
    ph,
    salinity_g_l_nacl: salinity,
    compressibility_factor: Z
  });

  let initialGasDerivedBottleMmol = initialState.total_bottle_mmol;
  if (gasId === "CO2" && initialState.estimated_DIC_mmol !== null &&
      initialState.estimated_DIC_mmol !== undefined) {
    initialGasDerivedBottleMmol =
      initialState.headspace_mmol + initialState.estimated_DIC_mmol;
  }
  if (gasId === "H2S" && initialState.estimated_total_sulfide_mmol !== null &&
      initialState.estimated_total_sulfide_mmol !== undefined) {
    initialGasDerivedBottleMmol =
      initialState.headspace_mmol + initialState.estimated_total_sulfide_mmol;
  }

  const targetMinusInitialMmol =
    targetGasDerivedBottleMmol - initialGasDerivedBottleMmol;
  const requiredTargetGasMmol = Math.max(0.0, targetMinusInitialMmol);
  const doseFraction = doseGasPercent / 100.0;
  const requiredDoseMixMmol = requiredTargetGasMmol / doseFraction;
  const requiredDoseMixMoles = requiredDoseMixMmol / MOL_TO_MMOL;
  const dosePressurePa = dosePressureBarAbs * BAR_TO_PA;

  const doseVolumeM3 =
    requiredDoseMixMoles * Z * R * temperatureK / dosePressurePa;
  const doseVolumeMl = doseVolumeM3 / ML_TO_M3;

  const warnings = [...initialState.warnings];
  if (salinityResult.warning && !warnings.includes(salinityResult.warning)) {
    warnings.push(salinityResult.warning);
  }
  if (targetMinusInitialMmol < 0) {
    warnings.push(
      "Target already reached. Gas to add is 0."
    );
  }

  return {
    gas_id: gasId,
    target_basis: targetBasis,
    target_dissolved_umol_L: targetUmolL,
    target_molecular_dissolved_mmol: targetMolecularDissolvedMmol,
    target_dissolved_mmol: targetBasis === "total_pool"
      ? targetReactivePoolMmol
      : targetMolecularDissolvedMmol,
    target_reactive_pool_mmol: targetReactivePoolMmol,
    target_headspace_mmol: targetHeadspaceMmol,
    target_total_bottle_mmol: targetGasDerivedBottleMmol,
    initial_total_bottle_mmol: initialGasDerivedBottleMmol,
    target_minus_initial_mmol: targetMinusInitialMmol,
    required_target_gas_mmol: requiredTargetGasMmol,
    dose_gas_percent: doseGasPercent,
    required_dose_mix_mmol: requiredDoseMixMmol,
    dose_pressure_bar_abs: dosePressureBarAbs,
    required_dose_mix_volume_mL: doseVolumeMl,
    required_partial_pressure_Pa: requiredPartialPressurePa,
    required_partial_pressure_bar: requiredPartialPressurePa / BAR_TO_PA,
    warnings
  };
}
