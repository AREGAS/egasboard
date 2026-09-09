/*
 * (E)Gasboard v0.1 - gas-property library
 *
 * This file is the browser-side equivalent of reference-python/gas_properties.py.
 * Values are deliberately written out as ordinary objects rather than hidden in
 * compressed or generated code. That keeps the scientific constants clear.
 *
 * Henry-law convention used throughout the tool:
 *
 *     Hcp = concentration / partial pressure
 *
 * with Hcp in mol m^-3 Pa^-1.
 *
 * Temperature correction (Sander, 2023, Eq. 5):
 *
 *     H(T) = H(Tref) * exp[B * (1/T - 1/Tref)]
 *
 * where Tref = 298.15 K and B is stored in kelvin.
 */

export const REFERENCE_TEMPERATURE_K = 298.15;

export const GAS_PROPERTIES = {
  CO: {
    gas_id: "CO",
    gas_name: "Carbon monoxide",
    cas_rn: "630-08-0",
    hcp_ref: 9.7e-6,
    B_K: 1300,
    selected_sander_entry: "Sander (2023)",
    temp_min_K: 278,
    temp_max_K: 323,
    temp_note: "Temperature range recorded for the selected Sander parameterization"
  },
  CO2: {
    gas_id: "CO2",
    gas_name: "Carbon dioxide",
    cas_rn: "124-38-9",
    hcp_ref: 3.4e-4,
    B_K: 2300,
    selected_sander_entry: "Sander (2023)",
    temp_min_K: null,
    temp_max_K: null,
    temp_note: "No explicit temperature range stored; local two-parameter correction around 298.15 K"
  },
  CH4: {
    gas_id: "CH4",
    gas_name: "Methane",
    cas_rn: "74-82-8",
    hcp_ref: 1.4e-5,
    B_K: 1600,
    selected_sander_entry: "Sander (2023)",
    temp_min_K: 275,
    temp_max_K: 328,
    temp_note: "Temperature range recorded for the selected Sander parameterization"
  },
  NO: {
    gas_id: "NO",
    gas_name: "Nitric oxide",
    cas_rn: "10102-43-9",
    hcp_ref: 1.9e-5,
    B_K: 1600,
    selected_sander_entry: "Sander (2023)",
    temp_min_K: null,
    temp_max_K: null,
    temp_note: "No explicit temperature range stored; local two-parameter correction around 298.15 K"
  },
  N2O: {
    gas_id: "N2O",
    gas_name: "Nitrous oxide",
    cas_rn: "10024-97-2",
    hcp_ref: 2.4e-4,
    B_K: 2600,
    selected_sander_entry: "Sander (2023)",
    temp_min_K: null,
    temp_max_K: null,
    temp_note: "No explicit temperature range stored; local two-parameter correction around 298.15 K"
  },
  H2S: {
    gas_id: "H2S",
    gas_name: "Hydrogen sulfide",
    cas_rn: "7783-06-4",
    hcp_ref: 1.0e-3,
    B_K: 2100,
    selected_sander_entry: "Sander (2023)",
    temp_min_K: null,
    temp_max_K: null,
    temp_note: "No explicit temperature range stored; local two-parameter correction around 298.15 K"
  },
  C2H6: {
    gas_id: "C2H6",
    gas_name: "Ethane",
    cas_rn: "74-84-0",
    hcp_ref: 1.9e-5,
    B_K: 2400,
    selected_sander_entry: "Sander (2023)",
    temp_min_K: 275,
    temp_max_K: 328,
    temp_note: "Temperature range recorded for the selected Sander parameterization"
  },
  N2: {
    gas_id: "N2",
    gas_name: "Nitrogen",
    cas_rn: "7727-37-9",
    hcp_ref: 6.4e-6,
    B_K: 1300,
    selected_sander_entry: "Sander (2023)",
    temp_min_K: 278.15,
    temp_max_K: 323.15,
    temp_note: "Temperature range recorded for the selected Sander parameterization"
  },
  O2: {
    gas_id: "O2",
    gas_name: "Oxygen",
    cas_rn: "7782-44-7",
    hcp_ref: 1.3e-5,
    B_K: 1500,
    selected_sander_entry: "Sander (2023)",
    temp_min_K: 274,
    temp_max_K: 328,
    temp_note: "Temperature range recorded for the selected Sander parameterization"
  }
};

export function getGasProperty(gasId) {
  const normalizedGasId = String(gasId).trim().toUpperCase();
  const gas = GAS_PROPERTIES[normalizedGasId];

  if (!gas) {
    const supported = Object.keys(GAS_PROPERTIES).join(", ");
    throw new Error(`Gas '${normalizedGasId}' is not available. Supported gases are: ${supported}`);
  }

  return gas;
}

export function calculateHenryConstant(gasId, temperatureK) {
  const temperature = Number(temperatureK);

  if (!(temperature > 0)) {
    throw new Error("Temperature must be above 0 K.");
  }

  const gas = getGasProperty(gasId);

  const temperatureTerm =
    (1.0 / temperature) - (1.0 / REFERENCE_TEMPERATURE_K);

  const exponent = gas.B_K * temperatureTerm;
  const correctedHcp = gas.hcp_ref * Math.exp(exponent);

  return correctedHcp;
}

export function checkTemperatureRange(gasId, temperatureK) {
  const gas = getGasProperty(gasId);
  const temperature = Number(temperatureK);

  if (gas.temp_min_K !== null && temperature < gas.temp_min_K) {
    return `${gas.gas_id}: ${temperature.toFixed(2)} K is below the documented supporting range ` +
           `(${gas.temp_min_K.toFixed(2)}-${gas.temp_max_K.toFixed(2)} K).`;
  }

  if (gas.temp_max_K !== null && temperature > gas.temp_max_K) {
    return `${gas.gas_id}: ${temperature.toFixed(2)} K is above the documented supporting range ` +
           `(${gas.temp_min_K.toFixed(2)}-${gas.temp_max_K.toFixed(2)} K).`;
  }

  return null;
}
