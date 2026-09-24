/*
 * (E)Gasboard v0.1 - gas-liquid mass-transfer screening
 *
 * This module estimates whether gas-liquid transfer can support an observed
 * gas-uptake rate. Built-in kLa values are deliberately rough screening
 * estimates for ordinary unbaffled orbital shaking and are not substitutes
 * for a measured kLa.
 *
 * Core equations:
 *
 *   C* = Hcp * p_i
 *   MTRmax = kLa * V_L * C*
 *   demand ratio = observed uptake / MTRmax
 *
 * When the demand ratio approaches 1, the process would require the bulk
 * dissolved concentration to approach zero in order for transfer alone to
 * support the observed uptake rate.
 */

import {
  calculateHenryConstant,
  checkTemperatureRange,
  getGasProperty,
  REFERENCE_TEMPERATURE_K
} from "./gas-properties.js";

import {
  calculateNaclSalinityCorrection,
  applySalinityToHenry
} from "./salinity.js";

const BAR_TO_PA = 100000.0;

export const KLA_SCREENING_TABLE = {
  // Deliberately broad screening values for ordinary unbaffled orbital shaking.
  // Edit here if better literature or vessel-specific measurements become available.
  tube: {
    label: "Tube (10-20 mL)",
    values: {100: 8, 150: 15, 200: 30, 400: 80}
  },
  flask: {
    label: "Flask (20-120 mL)",
    values: {100: 4, 150: 12, 200: 20, 400: 60}
  },
  small_bottle: {
    label: "Small bottle (120-500 mL)",
    values: {100: 5, 150: 10, 200: 15, 400: 40}
  },
  large_bottle: {
    label: "Large bottle (0.5-2 L)",
    values: {100: 2, 150: 5, 200: 8, 400: 25}
  }
};

export const KLA_GAS_LITERATURE = {
  O2: {
    support_level: "direct shaken-vessel literature",
    note: "O2 has the strongest shaken-vessel literature basis. Published bottle/flask studies show that kLa changes strongly with fill volume, vessel geometry, shaking speed and orbit diameter.",
    citation: "Logan & Kohler (2001), doi:10.2175/106143001X138697; Maier & Büchs (2001), doi:10.1016/S1369-703X(00)00107-8; Zhang et al. (2005), doi:10.1042/BA20040082"
  },
  CO: {
    support_level: "direct batch CO literature",
    note: "Direct CO batch data are available. Jang et al. obtained kLa ≈ 13 h⁻¹ for their vial-scale CO cultivation, and later serum-bottle work directly demonstrated CO-transfer limitation during batch gas fermentation.",
    citation: "Jang et al. (2017), doi:10.1016/j.biortech.2017.05.023; Schick et al. (2025), doi:10.1016/j.bej.2025.109838"
  },
  H2: {
    support_level: "direct H2-transfer literature",
    note: "Direct H2 mass-transfer measurements and batch studies are available, but reported behavior is system dependent and dissolved H2 can deviate strongly from Henry equilibrium during biological production.",
    citation: "Takeshita et al. (1993), doi:10.1016/0922-338X(93)90073-H; Beckers et al. (2015), doi:10.1016/j.bej.2015.01.008"
  },
  CH4: {
    support_level: "direct CH4-transfer literature",
    note: "Direct CH4 kLa measurements exist, including batch methane-utilizing cultures, but vessel-specific values vary substantially. Use the built-in value as a screening estimate unless a representative measurement is available.",
    citation: "Lamb & Garver (1980), doi:10.1002/bit.260221009"
  },
  CO2: {
    support_level: "hydrodynamic screening estimate",
    note: "No single bottle-specific CO2 kLa is assumed. The vessel × rpm value is used as a hydrodynamic screening estimate; rapid carbonate chemistry can alter the effective absorption behavior.",
    citation: "Maier & Büchs (2001), doi:10.1016/S1369-703X(00)00107-8; Zhang et al. (2005), doi:10.1042/BA20040082"
  },
  H2S: {
    support_level: "hydrodynamic screening estimate",
    note: "No direct bottle-specific H2S preset is assumed. The vessel × rpm value is used for screening only; aqueous sulfide speciation and reaction can alter effective transfer.",
    citation: "Shaken-vessel hydrodynamic literature"
  }
};

export function getKlaLiteratureBasis(gasId) {
  const gas = String(gasId).trim().toUpperCase();
  return KLA_GAS_LITERATURE[gas] || {
    support_level: "hydrodynamic screening estimate",
    note: "No direct bottle-specific kLa preset is stored for this gas; the vessel × rpm value is used as a hydrodynamic screening estimate.",
    citation: "Shaken-vessel screening literature"
  };
}

export const KLA_SCREENING_RELATIVE_RANGE = 0.50;

export function getKlaScreeningEstimate(vesselClass, shakingRpm, gasId = null) {
  const vessel = KLA_SCREENING_TABLE[String(vesselClass)];
  const rpm = Number(shakingRpm);

  if (!vessel) {
    throw new Error("Unknown vessel class for kLa screening estimate.");
  }

  const central = Number(vessel.values[rpm]);
  if (!(central > 0)) {
    throw new Error("No kLa screening estimate is available for that shaking speed.");
  }

  return {
    vessel_class: String(vesselClass),
    vessel_label: vessel.label,
    shaking_rpm: rpm,
    central_kla_h: central,
    low_kla_h: central * (1.0 - KLA_SCREENING_RELATIVE_RANGE),
    high_kla_h: central * (1.0 + KLA_SCREENING_RELATIVE_RANGE),
    relative_range: KLA_SCREENING_RELATIVE_RANGE,
    high_speed_extrapolation: rpm === 400,
    literature_basis: gasId ? getKlaLiteratureBasis(gasId) : null
  };
}

function convertObservedRateToMmolPerDay(value, unit, liquidVolumeL) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue) || numericValue < 0) {
    throw new Error("Observed gas uptake rate must be zero or larger.");
  }

  if (unit === "mmol_d") {
    return numericValue;
  }
  if (unit === "umol_d") {
    return numericValue / 1000.0;
  }
  if (unit === "mmol_h") {
    return numericValue * 24.0;
  }
  if (unit === "mmol_L_d") {
    return numericValue * liquidVolumeL;
  }

  throw new Error("Unknown gas-uptake rate unit.");
}

export function transferCapacityMmolPerDay(klaH, liquidVolumeL, cStarMmolL) {
  return Number(klaH) * Number(liquidVolumeL) * Number(cStarMmolL) * 24.0;
}

function demandRatio(observedMmolD, capacityMmolD) {
  if (capacityMmolD === 0) {
    return observedMmolD === 0 ? 0 : Infinity;
  }
  return observedMmolD / capacityMmolD;
}

function requiredBulkFraction(demand) {
  if (!Number.isFinite(demand)) return null;
  return 1.0 - demand;
}

function classifyCustomKla(demand) {
  if (!Number.isFinite(demand) || demand > 1.0) {
    return {
      level: "error",
      message:
        "Observed uptake exceeds the calculated maximum transfer capacity. " +
        "Check kLa, headspace composition, pressure and the uptake rate; if the inputs are correct, gas transfer limitation is expected."
    };
  }

  if (demand >= 0.8) {
    return {
      level: "warning",
      message:
        "Observed uptake is close to the calculated maximum transfer capacity. " +
        "Gas transfer limitation is plausible."
    };
  }

  if (demand >= 0.5) {
    return {
      level: "warning",
      message:
        "Gas transfer demand is substantial relative to the entered kLa. " +
        "Transfer limitation cannot be ruled out."
    };
  }

  return {
    level: "good",
    message:
      "Observed uptake is well below the calculated maximum transfer capacity for the entered kLa."
  };
}

function classifyEstimatedKla(observedMmolD, lowCapacity, centralCapacity, highCapacity) {
  if (observedMmolD > highCapacity) {
    return {
      level: "error",
      message:
        "Observed uptake exceeds even the high rough kLa estimate. If the entered rate and gas conditions are correct, gas transfer limitation is very likely; measure kLa for this system."
    };
  }

  if (observedMmolD > centralCapacity) {
    return {
      level: "warning",
      message:
        "Observed uptake exceeds the central kLa estimate but not the high estimate. Gas transfer limitation is plausible and depends strongly on the actual vessel-specific kLa."
    };
  }

  if (observedMmolD > lowCapacity) {
    return {
      level: "warning",
      message:
        "Observed uptake is supported by the central estimate but not by the low estimate. Gas transfer limitation cannot be ruled out without a measured kLa."
    };
  }

  return {
    level: "good",
    message:
      "Observed uptake is below the full rough kLa screening range. Strong gas-transfer limitation is not indicated by this estimate."
  };
}

export function calculateMassTransferAssessment({
  gas_id,
  observed_rate_value,
  observed_rate_unit = "mmol_d",
  liquid_volume_ml,
  temperature_c,
  pressure_bar_abs,
  headspace_gas_percent,
  salinity_g_l_nacl = 0.0,
  kla_source = "estimate",
  vessel_class = "small_bottle",
  shaking_rpm = 200,
  custom_kla_h = null,
  henry_source = "default",
  custom_hcp_ref = null,
  custom_henry_B_K = null
}) {
  const gasId = String(gas_id).trim().toUpperCase();
  const liquidVolumeMl = Number(liquid_volume_ml);
  const temperatureC = Number(temperature_c);
  const pressureBarAbs = Number(pressure_bar_abs);
  const gasPercent = Number(headspace_gas_percent);
  const salinity = Number(salinity_g_l_nacl ?? 0.0);
  const klaSource = String(kla_source || "estimate").trim().toLowerCase();
  const henrySource = String(henry_source || "default").trim().toLowerCase();

  if (!(liquidVolumeMl > 0)) {
    throw new Error("Liquid volume must be larger than zero.");
  }
  if (!(temperatureC > -273.15)) {
    throw new Error("Temperature must be above absolute zero.");
  }
  if (!(pressureBarAbs > 0)) {
    throw new Error("Absolute pressure must be larger than zero.");
  }
  if (!Number.isFinite(gasPercent) || gasPercent < 0 || gasPercent > 100) {
    throw new Error("Headspace gas concentration must be between 0 and 100%.");
  }
  if (salinity < 0) {
    throw new Error("NaCl-equivalent concentration cannot be negative.");
  }
  if (!["estimate", "custom"].includes(klaSource)) {
    throw new Error("kLa source must be a rough estimate or custom value.");
  }
  if (!["default", "custom"].includes(henrySource)) {
    throw new Error("Henry source must be the built-in value or a custom value.");
  }

  const liquidVolumeL = liquidVolumeMl / 1000.0;
  const observedMmolD = convertObservedRateToMmolPerDay(
    observed_rate_value,
    observed_rate_unit,
    liquidVolumeL
  );

  const temperatureK = temperatureC + 273.15;
  const totalPressurePa = pressureBarAbs * BAR_TO_PA;
  const gasFraction = gasPercent / 100.0;
  const partialPressurePa = gasFraction * totalPressurePa;

  const gasProperty = getGasProperty(gasId);
  let henryReference = gasProperty.hcp_ref;
  let henryBK = gasProperty.B_K;
  let henrySourceLabel = gasProperty.selected_sander_entry;
  let henryOverridden = false;

  let henryPureWater;
  if (henrySource === "custom") {
    henryReference = Number(custom_hcp_ref);
    henryBK = Number(custom_henry_B_K);

    if (!(henryReference > 0)) {
      throw new Error("Custom Hcp at 25 °C must be larger than zero.");
    }
    if (!Number.isFinite(henryBK)) {
      throw new Error("Custom Henry temperature coefficient B must be a finite number.");
    }

    const temperatureTerm =
      (1.0 / temperatureK) - (1.0 / REFERENCE_TEMPERATURE_K);
    henryPureWater = henryReference * Math.exp(henryBK * temperatureTerm);
    henrySourceLabel = "Custom user value";
    henryOverridden = true;
  } else {
    henryPureWater = calculateHenryConstant(gasId, temperatureK);
  }

  const salinityResult = calculateNaclSalinityCorrection(
    gasId,
    temperatureK,
    salinity
  );
  const henryConstant = applySalinityToHenry(
    henryPureWater,
    salinityResult.salting_out_factor
  );

  // Hcp [mol m^-3 Pa^-1] * p [Pa] = mol m^-3.
  // Numerically, 1 mol m^-3 = 1 mmol L^-1.
  const cStarMmolL = henryConstant * partialPressurePa;
  const cStarUmolL = cStarMmolL * 1000.0;

  let centralKlaH;
  let lowKlaH;
  let highKlaH;
  let estimate = null;

  if (klaSource === "estimate") {
    estimate = getKlaScreeningEstimate(vessel_class, shaking_rpm, gasId);
    centralKlaH = estimate.central_kla_h;
    lowKlaH = estimate.low_kla_h;
    highKlaH = estimate.high_kla_h;
  } else {
    centralKlaH = Number(custom_kla_h);
    if (!Number.isFinite(centralKlaH) || !(centralKlaH > 0)) {
      throw new Error("Custom kLa must be larger than zero.");
    }
    lowKlaH = centralKlaH;
    highKlaH = centralKlaH;
  }

  const lowCapacity = transferCapacityMmolPerDay(lowKlaH, liquidVolumeL, cStarMmolL);
  const centralCapacity = transferCapacityMmolPerDay(centralKlaH, liquidVolumeL, cStarMmolL);
  const highCapacity = transferCapacityMmolPerDay(highKlaH, liquidVolumeL, cStarMmolL);

  const lowDemand = demandRatio(observedMmolD, lowCapacity);
  const centralDemand = demandRatio(observedMmolD, centralCapacity);
  const highDemand = demandRatio(observedMmolD, highCapacity);

  const requiredKlaH = cStarMmolL > 0
    ? (observedMmolD / 24.0) / (liquidVolumeL * cStarMmolL)
    : (observedMmolD === 0 ? 0 : Infinity);

  const centralRequiredFraction = requiredBulkFraction(centralDemand);
  const centralRequiredBulkMmolL = centralRequiredFraction === null
    ? null
    : cStarMmolL * centralRequiredFraction;

  const assessment = klaSource === "estimate"
    ? classifyEstimatedKla(observedMmolD, lowCapacity, centralCapacity, highCapacity)
    : classifyCustomKla(centralDemand);

  const warnings = [];

  const temperatureWarning = checkTemperatureRange(gasId, temperatureK);
  if (temperatureWarning) warnings.push(temperatureWarning);
  if (salinityResult.warning) warnings.push(salinityResult.warning);

  if (klaSource === "estimate") {
    warnings.push(
      "Built-in kLa values are literature-based screening estimates for ordinary unbaffled orbital shaking. Vessel geometry, fill fraction, shaking orbit and medium properties can change the true kLa substantially."
    );

    if (estimate.high_speed_extrapolation) {
      warnings.push(
        "The 400 rpm option is a high-speed extrapolation and is more uncertain than the lower-speed screening values."
      );
    }

    const literatureBasis = getKlaLiteratureBasis(gasId);
    warnings.push(literatureBasis.note);
  }

  if (gasId === "CO2" || gasId === "H2S") {
    warnings.push(
      `${gasId}: this screen uses molecular gas transfer only. Rapid acid-base reaction or chemical consumption in the liquid can alter the effective absorption rate.`
    );
  }

  if (gasPercent === 0 && observedMmolD > 0) {
    warnings.push(
      "Headspace concentration is 0%, so the calculated equilibrium concentration and transfer capacity are zero."
    );
  }

  return {
    gas_id: gasId,
    observed_rate_mmol_d: observedMmolD,
    liquid_volume_L: liquidVolumeL,
    temperature_K: temperatureK,
    pressure_bar_abs: pressureBarAbs,
    headspace_gas_percent: gasPercent,
    headspace_gas_ppmv: gasPercent * 10000.0,
    partial_pressure_bar: partialPressurePa / BAR_TO_PA,
    partial_pressure_Pa: partialPressurePa,
    henry_source: henrySourceLabel,
    henry_overridden: henryOverridden,
    henry_reference_Hcp_mol_m3_Pa: henryReference,
    henry_B_K: henryBK,
    henry_temperature_corrected_pure_water: henryPureWater,
    henry_temperature_corrected: henryConstant,
    equilibrium_dissolved_mmol_L: cStarMmolL,
    equilibrium_dissolved_umol_L: cStarUmolL,
    kla_source: klaSource,
    vessel_class: estimate ? estimate.vessel_class : null,
    vessel_label: estimate ? estimate.vessel_label : null,
    shaking_rpm: estimate ? estimate.shaking_rpm : null,
    kla_literature_note: estimate && estimate.literature_basis ? estimate.literature_basis.note : null,
    kla_literature_citation: estimate && estimate.literature_basis ? estimate.literature_basis.citation : null,
    kla_low_h: lowKlaH,
    kla_central_h: centralKlaH,
    kla_high_h: highKlaH,
    transfer_capacity_low_mmol_d: lowCapacity,
    transfer_capacity_central_mmol_d: centralCapacity,
    transfer_capacity_high_mmol_d: highCapacity,
    transfer_demand_ratio_low_kla: lowDemand,
    transfer_demand_ratio_central: centralDemand,
    transfer_demand_ratio_high_kla: highDemand,
    minimum_required_kla_h: requiredKlaH,
    required_bulk_fraction_of_equilibrium_central: centralRequiredFraction,
    required_bulk_dissolved_mmol_L_central: centralRequiredBulkMmolL,
    required_bulk_dissolved_umol_L_central: centralRequiredBulkMmolL === null
      ? null
      : centralRequiredBulkMmolL * 1000.0,
    assessment_level: assessment.level,
    assessment_message: assessment.message,
    warnings
  };
}
