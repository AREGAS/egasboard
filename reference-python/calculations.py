"""
Core gas calculation for (E)Gasboard.

The calculation is deliberately written as a sequence of visible steps:

1. Convert the user inputs to SI units.
2. Convert gas % to a mole fraction.
3. Calculate gas partial pressure.
4. Temperature-correct the Henry constant.
5. Apply an optional NaCl salinity correction.
6. Calculate gas in the headspace.
6. Calculate neutral dissolved gas.
7. For CO2/H2S, optionally add pH-dependent dissolved species.
8. Add headspace and dissolved amounts.
"""

from gas_properties import calculate_henry_constant
from gas_properties import check_temperature_range
from gas_properties import get_gas_property
from speciation import calculate_co2_speciation
from speciation import calculate_h2s_speciation
from salinity import apply_salinity_to_henry
from salinity import calculate_nacl_salinity_correction


# ======================================================================
# CONSTANTS AND SIMPLE UNIT CONVERSIONS
# ======================================================================

# SI gas constant. With Pa and m3, J = Pa*m3.
R = 8.314462618  # J mol^-1 K^-1

BAR_TO_PA = 100000.0
ML_TO_M3 = 0.000001
MOL_TO_MMOL = 1000.0


def calculate_gas_state(
    gas_id,
    gas_percent,
    pressure_bar_abs,
    temperature_c,
    bottle_volume_ml,
    liquid_volume_ml,
    ph=None,
    salinity_g_l_nacl=0.0,
    compressibility_factor=1.0,
):
    """Calculate one measured bottle state."""

    # ==================================================================
    # STEP 0 - CHECK THE INPUTS
    # ==================================================================
    if gas_percent < 0 or gas_percent > 100:
        raise ValueError("Gas percentage must be between 0 and 100.")

    if pressure_bar_abs <= 0:
        raise ValueError("Absolute pressure must be larger than zero.")

    if bottle_volume_ml <= 0:
        raise ValueError("Bottle volume must be larger than zero.")

    if liquid_volume_ml < 0 or liquid_volume_ml >= bottle_volume_ml:
        raise ValueError(
            "Liquid volume must be at least 0 mL and smaller than bottle volume."
        )

    if temperature_c <= -273.15:
        raise ValueError("Temperature must be above absolute zero.")

    if compressibility_factor <= 0:
        raise ValueError("Compressibility factor Z must be larger than zero.")

    if salinity_g_l_nacl < 0:
        raise ValueError("NaCl salinity cannot be negative.")

    gas = get_gas_property(gas_id)

    # ==================================================================
    # STEP 1 - CONVERT THE USER INPUTS TO SI UNITS
    # ==================================================================
    temperature_k = temperature_c + 273.15
    total_pressure_pa = pressure_bar_abs * BAR_TO_PA

    headspace_volume_ml = bottle_volume_ml - liquid_volume_ml
    headspace_volume_m3 = headspace_volume_ml * ML_TO_M3
    liquid_volume_m3 = liquid_volume_ml * ML_TO_M3

    # ==================================================================
    # STEP 2 - CONVERT GAS % TO MOLE FRACTION
    # ==================================================================
    gas_fraction = gas_percent / 100.0

    # ==================================================================
    # STEP 3 - CALCULATE THE GAS PARTIAL PRESSURE
    # ==================================================================
    # Version 0.1 assumes a dry gas mixture: water vapour is neglected.
    partial_pressure_pa = gas_fraction * total_pressure_pa

    # ==================================================================
    # STEP 4 - TEMPERATURE-CORRECT THE HENRY SOLUBILITY
    # ==================================================================
    henry_pure_water = calculate_henry_constant(gas_id, temperature_k)

    # ==================================================================
    # STEP 4B - APPLY THE OPTIONAL NaCl SALINITY CORRECTION
    # ==================================================================
    salinity_result = calculate_nacl_salinity_correction(
        gas_id,
        temperature_k,
        salinity_g_l_nacl,
    )

    henry_constant = apply_salinity_to_henry(
        henry_pure_water,
        salinity_result["salting_out_factor"],
    )

    # ==================================================================
    # STEP 5 - CALCULATE GAS IN THE HEADSPACE
    # ==================================================================
    # Rearranged real/ideal gas law:
    # n = pV / (ZRT)
    numerator = partial_pressure_pa * headspace_volume_m3
    denominator = compressibility_factor * R * temperature_k
    headspace_moles = numerator / denominator
    headspace_mmol = headspace_moles * MOL_TO_MMOL

    # ==================================================================
    # STEP 6 - CALCULATE THE NEUTRAL DISSOLVED GAS
    # ==================================================================
    # Henry solubility definition:
    # Hcp = concentration / partial pressure
    # therefore concentration = Hcp * partial pressure
    neutral_concentration_mol_m3 = henry_constant * partial_pressure_pa

    neutral_dissolved_moles = (
        neutral_concentration_mol_m3 * liquid_volume_m3
    )
    neutral_dissolved_mmol = neutral_dissolved_moles * MOL_TO_MMOL

    # Reactive dissolved pools are calculated separately for CO2/H2S.
    # The generic bottle total always remains physical gas:
    # headspace + molecular dissolved gas.
    reactive_dissolved_moles = neutral_dissolved_moles
    speciation_results = None

    # ==================================================================
    # STEP 7 - OPTIONAL pH-DEPENDENT SPECIATION
    # ==================================================================
    if gas_id == "CO2" and ph is not None:
        speciation_results = calculate_co2_speciation(ph, temperature_k)
        reactive_factor = speciation_results["reactive_factor"]
        reactive_dissolved_moles = neutral_dissolved_moles * reactive_factor
        speciation_results["total_DIC_concentration_mol_m3"] = (
            neutral_concentration_mol_m3 * reactive_factor
        )

    if gas_id == "H2S" and ph is not None:
        speciation_results = calculate_h2s_speciation(ph, temperature_k)
        reactive_factor = speciation_results["reactive_factor"]
        reactive_dissolved_moles = neutral_dissolved_moles * reactive_factor
        speciation_results["total_sulfide_concentration_mol_m3"] = (
            neutral_concentration_mol_m3 * reactive_factor
        )

    reactive_dissolved_mmol = reactive_dissolved_moles * MOL_TO_MMOL

    # ==================================================================
    # STEP 8 - PHYSICAL BOTTLE AMOUNT
    # ==================================================================
    total_bottle_moles = headspace_moles + neutral_dissolved_moles
    total_bottle_mmol = total_bottle_moles * MOL_TO_MMOL

    # ==================================================================
    # STEP 9 - COLLECT WARNINGS
    # ==================================================================
    warnings = []

    temperature_warning = check_temperature_range(gas_id, temperature_k)
    if temperature_warning is not None:
        warnings.append(temperature_warning)

    if gas_id in ["CO2", "H2S"] and ph is None:
        warnings.append(
            gas_id
            + ": no pH supplied. pH-dependent speciation is not calculated."
        )

    if salinity_result["warning"] is not None:
        warnings.append(salinity_result["warning"])

    if speciation_results is not None:
        if speciation_results.get("warning") is not None:
            warnings.append(speciation_results["warning"])

    # ==================================================================
    # STEP 10 - RETURN RESULTS
    # ==================================================================
    result = {
        "gas_id": gas_id,
        "gas_name": gas["gas_name"],
        "temperature_K": temperature_k,
        "pressure_Pa_abs": total_pressure_pa,
        "gas_fraction": gas_fraction,
        "partial_pressure_Pa": partial_pressure_pa,
        "headspace_volume_mL": headspace_volume_ml,
        "headspace_volume_m3": headspace_volume_m3,
        "liquid_volume_m3": liquid_volume_m3,
        "henry_reference": gas["hcp_ref"],
        "henry_temperature_corrected_pure_water": henry_pure_water,
        "henry_temperature_corrected": henry_constant,
        "salinity_g_L_NaCl": salinity_g_l_nacl,
        "salinity_NaCl_mol_L": salinity_result["nacl_mol_L"],
        "salinity_correction_available": salinity_result["correction_available"],
        "sechenov_K": salinity_result["sechenov_K"],
        "salting_out_factor": salinity_result["salting_out_factor"],
        "henry_B_K": gas["B_K"],
        "selected_sander_entry": gas["selected_sander_entry"],
        "headspace_mmol": headspace_mmol,
        "neutral_dissolved_concentration_mol_m3": neutral_concentration_mol_m3,
        "molecular_dissolved_mmol": neutral_dissolved_mmol,
        "reactive_dissolved_mmol": reactive_dissolved_mmol,
        "total_bottle_mmol": total_bottle_mmol,
        "speciation": speciation_results,
        "warnings": warnings,
    }

    if gas_id == "CO2":
        result["estimated_DIC_mmol"] = (
            reactive_dissolved_mmol if ph is not None else None
        )

    if gas_id == "H2S":
        result["estimated_total_sulfide_mmol"] = (
            reactive_dissolved_mmol if ph is not None else None
        )

    return result


def calculate_required_gas_addition(
    gas_id,
    target_dissolved_umol_l,
    bottle_volume_ml,
    liquid_volume_ml,
    temperature_c,
    salinity_g_l_nacl=0.0,
    ph=None,
    initial_gas_percent=0.0,
    initial_pressure_bar_abs=1.01325,
    dose_gas_percent=100.0,
    dose_pressure_bar_abs=1.01325,
    compressibility_factor=1.0,
    target_basis="molecular",
):
    """Calculate gas addition for an equilibrium dissolved target.

    target_basis = "molecular" means molecular dissolved gas.
    target_basis = "total_pool" means DIC for CO2 or total sulfide for H2S.
    """

    if target_dissolved_umol_l < 0:
        raise ValueError("Target dissolved concentration cannot be negative.")

    target_basis = str(target_basis).strip().lower()
    if target_basis not in ["molecular", "total_pool"]:
        raise ValueError("Target basis must be molecular or total_pool.")
    if target_basis == "total_pool" and gas_id not in ["CO2", "H2S"]:
        raise ValueError("Total dissolved pool is only available for CO2 and H2S.")

    if dose_gas_percent <= 0 or dose_gas_percent > 100:
        raise ValueError("Dosing-gas percentage must be above 0 and at most 100%.")

    if dose_pressure_bar_abs <= 0:
        raise ValueError("Dosing-gas pressure must be larger than zero.")

    if bottle_volume_ml <= 0:
        raise ValueError("Bottle volume must be larger than zero.")

    if liquid_volume_ml < 0 or liquid_volume_ml >= bottle_volume_ml:
        raise ValueError(
            "Liquid volume must be at least 0 mL and smaller than bottle volume."
        )

    temperature_k = temperature_c + 273.15
    headspace_volume_ml = bottle_volume_ml - liquid_volume_ml
    headspace_volume_m3 = headspace_volume_ml * ML_TO_M3
    liquid_volume_m3 = liquid_volume_ml * ML_TO_M3

    # 1 micromol/L = 0.001 mol/m3.
    target_dissolved_mol_m3 = target_dissolved_umol_l * 0.001

    henry_pure_water = calculate_henry_constant(gas_id, temperature_k)
    salinity_result = calculate_nacl_salinity_correction(
        gas_id,
        temperature_k,
        salinity_g_l_nacl,
    )
    henry_constant = apply_salinity_to_henry(
        henry_pure_water,
        salinity_result["salting_out_factor"],
    )

    reactive_factor = 1.0
    speciation_results = None

    if gas_id == "CO2" and ph is not None:
        speciation_results = calculate_co2_speciation(ph, temperature_k)
        reactive_factor = speciation_results["reactive_factor"]

    if gas_id == "H2S" and ph is not None:
        speciation_results = calculate_h2s_speciation(ph, temperature_k)
        reactive_factor = speciation_results["reactive_factor"]

    if target_basis == "total_pool" and speciation_results is None:
        raise ValueError("pH is required when the target is DIC or total sulfide.")

    effective_henry = (
        henry_constant * reactive_factor
        if target_basis == "total_pool"
        else henry_constant
    )

    if effective_henry <= 0:
        raise ValueError("Effective Henry solubility must be larger than zero.")

    required_partial_pressure_pa = target_dissolved_mol_m3 / effective_henry
    target_molecular_concentration_mol_m3 = (
        henry_constant * required_partial_pressure_pa
    )
    target_pool_concentration_mol_m3 = (
        target_molecular_concentration_mol_m3 * reactive_factor
    )

    numerator = required_partial_pressure_pa * headspace_volume_m3
    denominator = compressibility_factor * R * temperature_k
    target_headspace_moles = numerator / denominator

    target_molecular_dissolved_moles = (
        target_molecular_concentration_mol_m3 * liquid_volume_m3
    )
    target_reactive_pool_moles = (
        target_pool_concentration_mol_m3 * liquid_volume_m3
    )
    target_gas_derived_bottle_moles = (
        target_headspace_moles + target_reactive_pool_moles
    )

    target_headspace_mmol = target_headspace_moles * MOL_TO_MMOL
    target_molecular_dissolved_mmol = (
        target_molecular_dissolved_moles * MOL_TO_MMOL
    )
    target_reactive_pool_mmol = target_reactive_pool_moles * MOL_TO_MMOL
    target_gas_derived_bottle_mmol = (
        target_gas_derived_bottle_moles * MOL_TO_MMOL
    )

    initial_state = calculate_gas_state(
        gas_id=gas_id,
        gas_percent=initial_gas_percent,
        pressure_bar_abs=initial_pressure_bar_abs,
        temperature_c=temperature_c,
        bottle_volume_ml=bottle_volume_ml,
        liquid_volume_ml=liquid_volume_ml,
        ph=ph,
        salinity_g_l_nacl=salinity_g_l_nacl,
        compressibility_factor=compressibility_factor,
    )

    initial_gas_derived_bottle_mmol = initial_state["total_bottle_mmol"]
    if gas_id == "CO2" and initial_state.get("estimated_DIC_mmol") is not None:
        initial_gas_derived_bottle_mmol = (
            initial_state["headspace_mmol"] + initial_state["estimated_DIC_mmol"]
        )
    if gas_id == "H2S" and initial_state.get("estimated_total_sulfide_mmol") is not None:
        initial_gas_derived_bottle_mmol = (
            initial_state["headspace_mmol"]
            + initial_state["estimated_total_sulfide_mmol"]
        )

    target_minus_initial_mmol = (
        target_gas_derived_bottle_mmol - initial_gas_derived_bottle_mmol
    )
    required_target_gas_mmol = max(0.0, target_minus_initial_mmol)

    dose_fraction = dose_gas_percent / 100.0
    required_dose_mix_mmol = required_target_gas_mmol / dose_fraction
    required_dose_mix_moles = required_dose_mix_mmol / MOL_TO_MMOL
    dose_pressure_pa = dose_pressure_bar_abs * BAR_TO_PA

    dose_volume_m3 = (
        required_dose_mix_moles
        * compressibility_factor
        * R
        * temperature_k
        / dose_pressure_pa
    )
    dose_volume_ml = dose_volume_m3 / ML_TO_M3

    warnings = []
    warnings.extend(initial_state["warnings"])

    if salinity_result["warning"] is not None:
        if salinity_result["warning"] not in warnings:
            warnings.append(salinity_result["warning"])

    if target_minus_initial_mmol < 0:
        warnings.append(
            "Target already reached. Gas to add is 0."
        )

    return {
        "gas_id": gas_id,
        "target_basis": target_basis,
        "target_dissolved_umol_L": target_dissolved_umol_l,
        "target_molecular_dissolved_mmol": target_molecular_dissolved_mmol,
        "target_dissolved_mmol": (
            target_reactive_pool_mmol
            if target_basis == "total_pool"
            else target_molecular_dissolved_mmol
        ),
        "target_reactive_pool_mmol": target_reactive_pool_mmol,
        "target_headspace_mmol": target_headspace_mmol,
        "target_total_bottle_mmol": target_gas_derived_bottle_mmol,
        "initial_total_bottle_mmol": initial_gas_derived_bottle_mmol,
        "target_minus_initial_mmol": target_minus_initial_mmol,
        "required_target_gas_mmol": required_target_gas_mmol,
        "dose_gas_percent": dose_gas_percent,
        "required_dose_mix_mmol": required_dose_mix_mmol,
        "dose_pressure_bar_abs": dose_pressure_bar_abs,
        "required_dose_mix_volume_mL": dose_volume_ml,
        "required_partial_pressure_Pa": required_partial_pressure_pa,
        "required_partial_pressure_bar": required_partial_pressure_pa / BAR_TO_PA,
        "henry_temperature_corrected": henry_constant,
        "effective_henry_for_target": effective_henry,
        "reactive_factor": reactive_factor,
        "speciation": speciation_results,
        "warnings": warnings,
    }
