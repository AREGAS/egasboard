"""
NaCl-equivalent salting-out correction for (E)Gasboard.

The first salinity implementation is kept simple and clear.
It treats the entered NaCl-equivalent concentration as NaCl-equivalent concentration and uses the Weisenberger-Schumpe salting-out model.

The model describes how dissolved salts reduce the physical solubility of
many gases. It does not change the gas-phase calculation.
"""

import math


# ======================================================================
# FIXED MODEL CONSTANTS
# ======================================================================

# Molar mass used to convert g/L NaCl to mol/L NaCl.
NACL_MOLAR_MASS_G_MOL = 58.44277

# Ion-specific parameters from Weisenberger and Schumpe (1996).
# Units: m3 kmol^-1, numerically equivalent to L mol^-1.
H_NA = 0.1143
H_CL = 0.0318

REFERENCE_TEMPERATURE_K = 298.15


# ======================================================================
# GAS-SPECIFIC PARAMETERS
# ======================================================================

# hG0 is the gas-specific parameter at 298.15 K.
# hT is the temperature coefficient in m3 kmol^-1 K^-1.
# A value of None means that no temperature coefficient was reported.
# CO is not included because the Weisenberger-Schumpe parameter set does
# not provide a gas-specific parameter for CO.
WS_GAS_PARAMETERS = {
    "CO2": {"hG0": -0.0172, "hT": -0.000338, "temp_min_K": 273.0, "temp_max_K": 313.0},
    "CH4": {"hG0": 0.0022, "hT": -0.000524, "temp_min_K": 273.0, "temp_max_K": 363.0},
    "NO": {"hG0": 0.0060, "hT": None, "temp_min_K": 298.15, "temp_max_K": 298.15},
    "N2O": {"hG0": -0.0085, "hT": -0.000479, "temp_min_K": 273.0, "temp_max_K": 313.0},
    "H2S": {"hG0": -0.0333, "hT": None, "temp_min_K": 298.15, "temp_max_K": 298.15},
    "C2H6": {"hG0": 0.0120, "hT": -0.000601, "temp_min_K": 273.0, "temp_max_K": 348.0},
    "N2": {"hG0": -0.0010, "hT": -0.000605, "temp_min_K": 278.0, "temp_max_K": 345.0},
    "O2": {"hG0": 0.0, "hT": -0.000334, "temp_min_K": 273.0, "temp_max_K": 353.0},
}


# ======================================================================
# SALINITY CALCULATION
# ======================================================================

def calculate_nacl_salinity_correction(gas_id, temperature_k, salinity_g_l_nacl):
    """Return the NaCl salting-out correction for one gas measurement."""

    gas_id = str(gas_id).strip().upper()
    temperature_k = float(temperature_k)
    salinity_g_l_nacl = float(salinity_g_l_nacl)

    if salinity_g_l_nacl < 0:
        raise ValueError("NaCl-equivalent concentration cannot be negative.")

    # No salt means no correction, regardless of whether the gas has a
    # Weisenberger-Schumpe parameter.
    if salinity_g_l_nacl == 0:
        return {
            "correction_available": True,
            "nacl_mol_L": 0.0,
            "hG": None,
            "sechenov_K": 0.0,
            "salting_out_factor": 1.0,
            "warning": None,
        }

    if gas_id not in WS_GAS_PARAMETERS:
        return {
            "correction_available": False,
            "nacl_mol_L": salinity_g_l_nacl / NACL_MOLAR_MASS_G_MOL,
            "hG": None,
            "sechenov_K": None,
            "salting_out_factor": 1.0,
            "warning": (
                gas_id
                + ": no Weisenberger-Schumpe salting-out parameter is available. "
                + "The pure-water Henry solubility is therefore retained."
            ),
        }

    gas_parameters = WS_GAS_PARAMETERS[gas_id]
    hG0 = gas_parameters["hG0"]
    hT = gas_parameters["hT"]

    warning_messages = []

    if hT is None:
        # For NO and H2S, the source parameter is only available at 298.15 K.
        hG = hG0

        if abs(temperature_k - REFERENCE_TEMPERATURE_K) > 0.01:
            warning_messages.append(
                gas_id
                + ": the selected salting-out parameter is reported only at 298.15 K; "
                + "using it at this temperature is an extrapolation."
            )
    else:
        hG = hG0 + hT * (temperature_k - REFERENCE_TEMPERATURE_K)

        minimum = gas_parameters["temp_min_K"]
        maximum = gas_parameters["temp_max_K"]

        if temperature_k < minimum or temperature_k > maximum:
            warning_messages.append(
                gas_id
                + ": temperature is outside the supporting range for the "
                + "Weisenberger-Schumpe salting-out correction "
                + f"({minimum:.0f}-{maximum:.0f} K)."
            )

    # Convert g/L NaCl to mol/L. 1 mol/L is numerically the same as
    # 1 kmol/m3, the concentration unit used in the original model.
    nacl_mol_l = salinity_g_l_nacl / NACL_MOLAR_MASS_G_MOL

    # For NaCl, one Na+ and one Cl- ion are present per formula unit.
    # K = (h_Na + hG) + (h_Cl + hG)
    sechenov_K = H_NA + H_CL + (2.0 * hG)

    # Sechenov relation:
    # log10(c_water / c_salt) = K * c_NaCl
    salting_out_factor = 10.0 ** (sechenov_K * nacl_mol_l)

    if nacl_mol_l > 2.0:
        warning_messages.append(
            "NaCl concentration is above 2 mol/L. The simple Sechenov relation "
            "is being used beyond its normal recommended concentration range."
        )

    if len(warning_messages) == 0:
        warning = None
    else:
        warning = " | ".join(warning_messages)

    return {
        "correction_available": True,
        "nacl_mol_L": nacl_mol_l,
        "hG": hG,
        "sechenov_K": sechenov_K,
        "salting_out_factor": salting_out_factor,
        "warning": warning,
    }


def apply_salinity_to_henry(hcp_pure_water, salting_out_factor):
    """Convert pure-water Hcp to NaCl-corrected Hcp."""

    hcp_pure_water = float(hcp_pure_water)
    salting_out_factor = float(salting_out_factor)

    if salting_out_factor <= 0:
        raise ValueError("Salting-out factor must be larger than zero.")

    # Hcp = concentration / pressure. Salting out lowers concentration,
    # so Hcp decreases by the same factor.
    hcp_salt_solution = hcp_pure_water / salting_out_factor

    return hcp_salt_solution
