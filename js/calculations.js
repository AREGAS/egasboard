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
  target_mode = "dissolved",
  target_dissolved_umol_l = null,
  target_headspace_percent = null,
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
  const targetMode = String(target_mode || "dissolved").trim().toLowerCase();
  const targetBasis = String(target_basis || "molecular").trim().toLowerCase();
  const bottleVolumeMl = Number(bottle_volume_ml);
  const liquidVolumeMl = Number(liquid_volume_ml);
  const temperatureC = Number(temperature_c);
  const salinity = Number(salinity_g_l_nacl ?? 0.0);
  const initialGasPercent = Number(initial_gas_percent);
  const initialPressureBarAbs = Number(initial_pressure_bar_abs);
  const doseGasPercent = Number(dose_gas_percent);
  const dosePressureBarAbs = Number(dose_pressure_bar_abs);
  const Z = Number(compressibility_factor);

  if (!["dissolved", "headspace"].includes(targetMode)) {
    throw new Error("Target mode must be dissolved or headspace.");
  }
  if (!["molecular", "total_pool"].includes(targetBasis)) {
    throw new Error("Target basis must be molecular or total_pool.");
  }
  if (targetBasis === "total_pool" && !["CO2", "H2S"].includes(gasId)) {
    throw new Error("Total dissolved pool is only available for CO2 and H2S.");
  }
  if (!(doseGasPercent > 0) || doseGasPercent > 100) {
    throw new Error("Dosing-gas concentration must be above 0 and at most 100%.");
  }
  if (!(dosePressureBarAbs > 0)) {
    throw new Error("Dosing-gas pressure must be larger than zero.");
  }
  if (!(initialPressureBarAbs > 0)) {
    throw new Error("Initial pressure must be larger than zero.");
  }
  if (initialGasPercent < 0 || initialGasPercent > 100) {
    throw new Error("Initial headspace gas concentration must be between 0 and 100%.");
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

  const temperatureK = temperatureC + 273.15;
  const headspaceVolumeM3 = (bottleVolumeMl - liquidVolumeMl) * ML_TO_M3;
  const liquidVolumeM3 = liquidVolumeMl * ML_TO_M3;

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

  if (targetMode === "dissolved" && targetBasis === "total_pool" && !speciation) {
    throw new Error("pH is required when the target is DIC or total sulfide.");
  }

  const initialState = calculateGasState({
    gas_id: gasId,
    gas_percent: initialGasPercent,
    pressure_bar_abs: initialPressureBarAbs,
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

  const initialGasDerivedBottleMoles = initialGasDerivedBottleMmol / MOL_TO_MMOL;
  const initialTotalPressurePa = initialPressureBarAbs * BAR_TO_PA;
  const initialTotalHeadspaceMoles =
    (initialTotalPressurePa * headspaceVolumeM3) /
    (Z * R * temperatureK);
  const initialTargetHeadspaceMoles = initialState.headspace_mmol / MOL_TO_MMOL;
  const initialNonTargetHeadspaceMoles = Math.max(
    0.0,
    initialTotalHeadspaceMoles - initialTargetHeadspaceMoles
  );

  // At equilibrium, target-gas-derived moles are linear with target-gas
  // partial pressure. For CO2/H2S, the pH-dependent dissolved pool is included
  // when pH is supplied.
  const gasDerivedCapacityMolPerPa =
    headspaceVolumeM3 / (Z * R * temperatureK) +
    henryConstant * reactiveFactor * liquidVolumeM3;

  if (!(gasDerivedCapacityMolPerPa > 0)) {
    throw new Error("Gas-equilibrium capacity must be larger than zero.");
  }

  const pressurePerHeadspaceMolePa =
    (Z * R * temperatureK) / headspaceVolumeM3;
  const doseFraction = doseGasPercent / 100.0;

  let requestedPartialPressurePa = null;
  let requestedHeadspacePercent = null;
  let requestedHeadspacePpmv = null;
  let targetDissolvedUmolL = null;
  let requiredDoseMixMoles = 0.0;
  let targetMinusInitialMmol = 0.0;
  const warnings = [...initialState.warnings];

  if (salinityResult.warning && !warnings.includes(salinityResult.warning)) {
    warnings.push(salinityResult.warning);
  }

  if (targetMode === "dissolved") {
    targetDissolvedUmolL = Number(target_dissolved_umol_l);
    if (!Number.isFinite(targetDissolvedUmolL) || targetDissolvedUmolL < 0) {
      throw new Error("Target dissolved concentration must be zero or larger.");
    }

    // 1 µmol/L = 0.001 mol/m3.
    const targetDissolvedMolM3 = targetDissolvedUmolL * 0.001;
    const effectiveHenry = targetBasis === "total_pool"
      ? henryConstant * reactiveFactor
      : henryConstant;

    if (!(effectiveHenry > 0)) {
      throw new Error("Effective Henry solubility must be larger than zero.");
    }

    requestedPartialPressurePa = targetDissolvedMolM3 / effectiveHenry;
    const requestedGasDerivedBottleMoles =
      gasDerivedCapacityMolPerPa * requestedPartialPressurePa;

    targetMinusInitialMmol =
      (requestedGasDerivedBottleMoles - initialGasDerivedBottleMoles) * MOL_TO_MMOL;

    if (targetMinusInitialMmol <= 0) {
      requiredDoseMixMoles = 0.0;
      warnings.push("Target already reached. Gas to add is 0.");
    } else {
      requiredDoseMixMoles =
        (targetMinusInitialMmol / MOL_TO_MMOL) / doseFraction;
    }
  } else {
    requestedHeadspacePercent = Number(target_headspace_percent);
    if (!Number.isFinite(requestedHeadspacePercent) ||
        requestedHeadspacePercent < 0 || requestedHeadspacePercent >= 100) {
      throw new Error("Target headspace concentration must be at least 0% and below 100%.");
    }

    requestedHeadspacePpmv = requestedHeadspacePercent * 10000.0;
    const requestedFraction = requestedHeadspacePercent / 100.0;
    const initialFraction = initialGasPercent / 100.0;

    if (initialFraction >= requestedFraction) {
      requiredDoseMixMoles = 0.0;
      warnings.push("Target headspace concentration is already reached or exceeded. Gas to add is 0.");
    } else if (requestedFraction === 0) {
      requiredDoseMixMoles = 0.0;
    } else {
      // Let p_target / p_other = x_target / (1 - x_target). The target gas
      // partitions between headspace and liquid, while the non-target fraction
      // of the dosing mixture is assumed to remain in the headspace.
      const targetToOtherPressureRatio =
        requestedFraction / (1.0 - requestedFraction);
      const equilibriumRatio =
        gasDerivedCapacityMolPerPa *
        targetToOtherPressureRatio *
        pressurePerHeadspaceMolePa;

      const denominator =
        doseFraction - equilibriumRatio * (1.0 - doseFraction);
      const numerator =
        equilibriumRatio * initialNonTargetHeadspaceMoles -
        initialGasDerivedBottleMoles;

      if (!(denominator > 0)) {
        throw new Error(
          "The requested headspace concentration cannot be reached with this dosing mixture under the entered conditions. Increase the target-gas concentration of the dosing mixture."
        );
      }

      requiredDoseMixMoles = numerator / denominator;

      if (!(requiredDoseMixMoles >= 0) || !Number.isFinite(requiredDoseMixMoles)) {
        throw new Error(
          "The requested headspace concentration cannot be reached from the entered starting conditions by adding this dosing mixture."
        );
      }

      targetMinusInitialMmol =
        doseFraction * requiredDoseMixMoles * MOL_TO_MMOL;
    }
  }

  const addedTargetGasMoles = doseFraction * requiredDoseMixMoles;
  const addedNonTargetGasMoles = (1.0 - doseFraction) * requiredDoseMixMoles;
  const finalTargetGasDerivedMoles =
    initialGasDerivedBottleMoles + addedTargetGasMoles;
  const finalNonTargetHeadspaceMoles =
    initialNonTargetHeadspaceMoles + addedNonTargetGasMoles;

  const finalPartialPressurePa =
    finalTargetGasDerivedMoles / gasDerivedCapacityMolPerPa;
  const finalNonTargetPressurePa =
    finalNonTargetHeadspaceMoles * pressurePerHeadspaceMolePa;
  const finalPressurePa = finalPartialPressurePa + finalNonTargetPressurePa;
  const finalHeadspaceFraction = finalPressurePa > 0
    ? finalPartialPressurePa / finalPressurePa
    : 0.0;
  const finalHeadspacePercent = finalHeadspaceFraction * 100.0;
  const finalHeadspacePpmv = finalHeadspaceFraction * 1_000_000.0;

  const finalMolecularConcentrationMolM3 =
    henryConstant * finalPartialPressurePa;
  const finalReactivePoolConcentrationMolM3 =
    finalMolecularConcentrationMolM3 * reactiveFactor;
  const finalHeadspaceMoles =
    (finalPartialPressurePa * headspaceVolumeM3) /
    (Z * R * temperatureK);
  const finalMolecularDissolvedMoles =
    finalMolecularConcentrationMolM3 * liquidVolumeM3;
  const finalReactivePoolMoles =
    finalReactivePoolConcentrationMolM3 * liquidVolumeM3;

  const requiredDoseMixMmol = requiredDoseMixMoles * MOL_TO_MMOL;
  const requiredTargetGasMmol = addedTargetGasMoles * MOL_TO_MMOL;
  const dosePressurePa = dosePressureBarAbs * BAR_TO_PA;
  const doseVolumeM3 =
    requiredDoseMixMoles * Z * R * temperatureK / dosePressurePa;
  const doseVolumeMl = doseVolumeM3 / ML_TO_M3;

  if (targetMode === "headspace" && ["CO2", "H2S"].includes(gasId) && !speciation) {
    warnings.push(
      `${gasId}: headspace-target dosing without pH includes molecular dissolution only; the pH-dependent dissolved pool is not included.`
    );
  }

  return {
    gas_id: gasId,
    target_mode: targetMode,
    target_basis: targetBasis,
    target_dissolved_umol_L: targetDissolvedUmolL,
    target_headspace_percent: requestedHeadspacePercent,
    target_headspace_ppmv: requestedHeadspacePpmv,

    initial_total_bottle_mmol: initialGasDerivedBottleMmol,
    target_minus_initial_mmol: targetMinusInitialMmol,
    required_target_gas_mmol: requiredTargetGasMmol,
    dose_gas_percent: doseGasPercent,
    required_dose_mix_mmol: requiredDoseMixMmol,
    dose_pressure_bar_abs: dosePressureBarAbs,
    required_dose_mix_volume_mL: doseVolumeMl,

    required_partial_pressure_Pa: requestedPartialPressurePa,
    required_partial_pressure_bar: requestedPartialPressurePa === null
      ? null
      : requestedPartialPressurePa / BAR_TO_PA,

    final_partial_pressure_Pa: finalPartialPressurePa,
    final_partial_pressure_bar: finalPartialPressurePa / BAR_TO_PA,
    final_pressure_bar_abs: finalPressurePa / BAR_TO_PA,
    final_headspace_percent: finalHeadspacePercent,
    final_headspace_ppmv: finalHeadspacePpmv,
    final_headspace_mmol: finalHeadspaceMoles * MOL_TO_MMOL,
    final_molecular_dissolved_umol_L:
      finalMolecularConcentrationMolM3 * 1000.0,
    final_molecular_dissolved_mmol:
      finalMolecularDissolvedMoles * MOL_TO_MMOL,
    final_reactive_pool_umol_L:
      finalReactivePoolConcentrationMolM3 * 1000.0,
    final_reactive_pool_mmol:
      finalReactivePoolMoles * MOL_TO_MMOL,
    final_total_gas_derived_mmol:
      finalTargetGasDerivedMoles * MOL_TO_MMOL,

    // Backward-compatible names used by the existing dissolved-target tests/UI.
    target_molecular_dissolved_mmol:
      finalMolecularDissolvedMoles * MOL_TO_MMOL,
    target_dissolved_mmol: targetBasis === "total_pool"
      ? finalReactivePoolMoles * MOL_TO_MMOL
      : finalMolecularDissolvedMoles * MOL_TO_MMOL,
    target_reactive_pool_mmol:
      finalReactivePoolMoles * MOL_TO_MMOL,
    target_headspace_mmol:
      finalHeadspaceMoles * MOL_TO_MMOL,
    target_total_bottle_mmol:
      finalTargetGasDerivedMoles * MOL_TO_MMOL,

    henry_temperature_corrected: henryConstant,
    reactive_factor: reactiveFactor,
    speciation,
    warnings
  };
}
