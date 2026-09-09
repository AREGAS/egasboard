/*
 * (E)Gasboard v0.1 - NaCl-equivalent salting-out correction
 *
 * Weisenberger-Schumpe (1996) salting-out model:
 *
 *     log10(c_water / c_salt) = K_s * c_NaCl
 *
 * Entered NaCl-equivalent concentration is treated as NaCl concentration or NaCl-equivalent
 * salinity. This changes dissolved solubility only; it does not alter the
 * gas-phase ideal-gas calculation.
 */

export const NACL_MOLAR_MASS_G_MOL = 58.44277;
export const H_NA = 0.1143;
export const H_CL = 0.0318;
export const REFERENCE_TEMPERATURE_K = 298.15;

export const WS_GAS_PARAMETERS = {
  CO2: {hG0: -0.0172, hT: -0.000338, temp_min_K: 273.0, temp_max_K: 313.0},
  CH4: {hG0:  0.0022, hT: -0.000524, temp_min_K: 273.0, temp_max_K: 363.0},
  NO:  {hG0:  0.0060, hT: null,      temp_min_K: 298.15, temp_max_K: 298.15},
  N2O: {hG0: -0.0085, hT: -0.000479, temp_min_K: 273.0, temp_max_K: 313.0},
  H2S: {hG0: -0.0333, hT: null,      temp_min_K: 298.15, temp_max_K: 298.15},
  C2H6:{hG0:  0.0120, hT: -0.000601, temp_min_K: 273.0, temp_max_K: 348.0},
  N2:  {hG0: -0.0010, hT: -0.000605, temp_min_K: 278.0, temp_max_K: 345.0},
  O2:  {hG0:  0.0,    hT: -0.000334, temp_min_K: 273.0, temp_max_K: 353.0}
};

export function calculateNaclSalinityCorrection(gasId, temperatureK, salinityGLNacl) {
  const gas = String(gasId).trim().toUpperCase();
  const temperature = Number(temperatureK);
  const salinity = Number(salinityGLNacl);

  if (salinity < 0) {
    throw new Error("NaCl-equivalent concentration cannot be negative.");
  }

  if (salinity === 0) {
    return {
      correction_available: true,
      nacl_mol_L: 0.0,
      hG: null,
      sechenov_K: 0.0,
      salting_out_factor: 1.0,
      warning: null
    };
  }

  const naclMolL = salinity / NACL_MOLAR_MASS_G_MOL;
  const gasParameters = WS_GAS_PARAMETERS[gas];

  if (!gasParameters) {
    return {
      correction_available: false,
      nacl_mol_L: naclMolL,
      hG: null,
      sechenov_K: null,
      salting_out_factor: 1.0,
      warning:
        `${gas}: no Weisenberger-Schumpe salting-out parameter is available. ` +
        "The pure-water Henry solubility is therefore retained."
    };
  }

  const warningMessages = [];
  let hG;

  if (gasParameters.hT === null) {
    hG = gasParameters.hG0;

    if (Math.abs(temperature - REFERENCE_TEMPERATURE_K) > 0.01) {
      warningMessages.push(
        `${gas}: the selected salting-out parameter is reported only at 298.15 K; ` +
        "using it at this temperature is an extrapolation."
      );
    }
  } else {
    hG = gasParameters.hG0 +
         gasParameters.hT * (temperature - REFERENCE_TEMPERATURE_K);

    if (temperature < gasParameters.temp_min_K ||
        temperature > gasParameters.temp_max_K) {
      warningMessages.push(
        `${gas}: temperature is outside the supporting range for the ` +
        `Weisenberger-Schumpe salting-out correction ` +
        `(${gasParameters.temp_min_K.toFixed(0)}-${gasParameters.temp_max_K.toFixed(0)} K).`
      );
    }
  }

  const sechenovK = H_NA + H_CL + (2.0 * hG);
  const saltingOutFactor = 10.0 ** (sechenovK * naclMolL);

  if (naclMolL > 2.0) {
    warningMessages.push(
      "NaCl concentration is above 2 mol/L. The simple Sechenov relation " +
      "is being used beyond its normal recommended concentration range."
    );
  }

  return {
    correction_available: true,
    nacl_mol_L: naclMolL,
    hG,
    sechenov_K: sechenovK,
    salting_out_factor: saltingOutFactor,
    warning: warningMessages.length ? warningMessages.join(" | ") : null
  };
}

export function applySalinityToHenry(hcpPureWater, saltingOutFactor) {
  const hcp = Number(hcpPureWater);
  const factor = Number(saltingOutFactor);

  if (!(factor > 0)) {
    throw new Error("Salting-out factor must be larger than zero.");
  }

  return hcp / factor;
}
