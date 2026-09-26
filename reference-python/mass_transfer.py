"""Gas-liquid mass-transfer screening for (E)Gasboard.

Built-in kLa values are intentionally rough screening estimates for ordinary
unbaffled orbital shaking. A measured gas- and vessel-specific kLa is preferred.
"""

import math

from gas_properties import calculate_henry_constant
from gas_properties import check_temperature_range
from gas_properties import get_gas_property
from gas_properties import REFERENCE_TEMPERATURE_K
from salinity import apply_salinity_to_henry
from salinity import calculate_nacl_salinity_correction


BAR_TO_PA = 100000.0
KLA_SCREENING_RELATIVE_RANGE = 0.50

KLA_SCREENING_TABLE = {
    # Deliberately broad screening values for ordinary unbaffled orbital shaking.
    # Edit here if better literature or vessel-specific measurements become available.
    "tube": {
        "label": "Tube (10-20 mL)",
        "values": {100: 8.0, 150: 15.0, 200: 30.0, 400: 80.0},
    },
    "flask": {
        "label": "Flask (20-120 mL)",
        "values": {100: 4.0, 150: 12.0, 200: 20.0, 400: 60.0},
    },
    "small_bottle": {
        "label": "Small bottle (120-500 mL)",
        "values": {100: 5.0, 150: 10.0, 200: 15.0, 400: 40.0},
    },
    "large_bottle": {
        "label": "Large bottle (0.5-2 L)",
        "values": {100: 2.0, 150: 5.0, 200: 8.0, 400: 25.0},
    },
}

KLA_GAS_LITERATURE = {
    "O2": {
        "note": "Direct shaken-vessel O2-transfer literature is available and is used as the main hydrodynamic basis for the screening table.",
        "citation": "Zhang et al. (2005); Maschke et al. (2022)",
    },
    "CO": {
        "note": "Direct CO batch data are available: Jang et al. reported kLa ≈ 13 h^-1 for their vial-scale CO cultivation. The vessel × rpm table remains a screening estimate for other geometries.",
        "citation": "Jang et al. (2017), Bioresource Technology 239, 387-393",
    },
}


def get_kla_literature_basis(gas_id):
    gas_id = str(gas_id).strip().upper()
    return KLA_GAS_LITERATURE.get(
        gas_id,
        {
            "note": "No direct bottle-specific kLa preset is stored for this gas; the vessel × rpm value is used as a hydrodynamic screening estimate.",
            "citation": "Shaken-vessel screening literature",
        },
    )


def get_kla_screening_estimate(vessel_class, shaking_rpm, gas_id=None):
    vessel_key = str(vessel_class)
    rpm = int(shaking_rpm)

    if vessel_key not in KLA_SCREENING_TABLE:
        raise ValueError("Unknown vessel class for kLa screening estimate.")

    vessel = KLA_SCREENING_TABLE[vessel_key]
    central = vessel["values"].get(rpm)

    if central is None or central <= 0:
        raise ValueError("No kLa screening estimate is available for that shaking speed.")

    return {
        "vessel_class": vessel_key,
        "vessel_label": vessel["label"],
        "shaking_rpm": rpm,
        "central_kla_h": central,
        "low_kla_h": central * (1.0 - KLA_SCREENING_RELATIVE_RANGE),
        "high_kla_h": central * (1.0 + KLA_SCREENING_RELATIVE_RANGE),
        "relative_range": KLA_SCREENING_RELATIVE_RANGE,
        "high_speed_extrapolation": rpm == 400,
        "literature_basis": get_kla_literature_basis(gas_id) if gas_id else None,
    }


def _convert_rate_to_mmol_d(value, unit, liquid_volume_l):
    value = float(value)
    if value < 0:
        raise ValueError("Observed gas uptake rate must be zero or larger.")

    if unit == "mmol_d":
        return value
    if unit == "umol_d":
        return value / 1000.0
    if unit == "mmol_h":
        return value * 24.0
    if unit == "mmol_L_d":
        return value * liquid_volume_l

    raise ValueError("Unknown gas-uptake rate unit.")


def _capacity_mmol_d(kla_h, liquid_volume_l, c_star_mmol_l):
    return float(kla_h) * liquid_volume_l * c_star_mmol_l * 24.0


def calculate_mass_transfer_assessment(
    gas_id,
    observed_rate_value,
    observed_rate_unit,
    bottle_volume_ml,
    liquid_volume_ml,
    temperature_c,
    pressure_bar_abs,
    headspace_gas_percent,
    salinity_g_l_nacl=0.0,
    kla_source="estimate",
    vessel_class="small_bottle",
    shaking_rpm=200,
    custom_kla_h=None,
    henry_source="default",
    custom_hcp_ref=None,
    custom_henry_B_K=None,
):
    bottle_volume_ml = float(bottle_volume_ml)
    liquid_volume_ml = float(liquid_volume_ml)
    temperature_c = float(temperature_c)
    pressure_bar_abs = float(pressure_bar_abs)
    headspace_gas_percent = float(headspace_gas_percent)
    salinity_g_l_nacl = float(salinity_g_l_nacl)
    kla_source = str(kla_source).strip().lower()
    henry_source = str(henry_source).strip().lower()

    if bottle_volume_ml <= 0:
        raise ValueError("Vessel volume must be larger than zero.")
    if liquid_volume_ml <= 0:
        raise ValueError("Liquid volume must be larger than zero.")
    if bottle_volume_ml <= liquid_volume_ml:
        raise ValueError("Vessel volume must be larger than liquid volume.")
    if temperature_c <= -273.15:
        raise ValueError("Temperature must be above absolute zero.")
    if pressure_bar_abs <= 0:
        raise ValueError("Absolute pressure must be larger than zero.")
    if headspace_gas_percent < 0 or headspace_gas_percent > 100:
        raise ValueError("Headspace gas concentration must be between 0 and 100%.")
    if salinity_g_l_nacl < 0:
        raise ValueError("NaCl-equivalent concentration cannot be negative.")
    if kla_source not in ["estimate", "custom"]:
        raise ValueError("kLa source must be a rough estimate or custom value.")
    if henry_source not in ["default", "custom"]:
        raise ValueError("Henry source must be the built-in value or a custom value.")

    liquid_volume_l = liquid_volume_ml / 1000.0
    headspace_volume_l = (bottle_volume_ml - liquid_volume_ml) / 1000.0
    observed_mmol_d = _convert_rate_to_mmol_d(
        observed_rate_value,
        observed_rate_unit,
        liquid_volume_l,
    )

    temperature_k = temperature_c + 273.15
    partial_pressure_pa = (
        headspace_gas_percent / 100.0
        * pressure_bar_abs
        * BAR_TO_PA
    )

    gas_property = get_gas_property(str(gas_id).strip().upper())
    henry_reference = gas_property["hcp_ref"]
    henry_b_k = gas_property["B_K"]
    henry_source_label = gas_property["selected_sander_entry"]
    henry_overridden = False

    if henry_source == "custom":
        henry_reference = float(custom_hcp_ref)
        henry_b_k = float(custom_henry_B_K)
        if henry_reference <= 0:
            raise ValueError("Custom Hcp at 25 °C must be larger than zero.")
        temperature_term = (1.0 / temperature_k) - (1.0 / REFERENCE_TEMPERATURE_K)
        henry_pure_water = henry_reference * math.exp(henry_b_k * temperature_term)
        henry_source_label = "Custom user value"
        henry_overridden = True
    else:
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

    c_star_mmol_l = henry_constant * partial_pressure_pa
    c_star_umol_l = c_star_mmol_l * 1000.0

    gas_constant = 8.314462618
    headspace_gas_mmol = (
        partial_pressure_pa
        * (headspace_volume_l / 1000.0)
        / (gas_constant * temperature_k)
        * 1000.0
    )
    equilibrium_dissolved_mmol = c_star_mmol_l * liquid_volume_l
    total_equilibrium_gas_mmol = headspace_gas_mmol + equilibrium_dissolved_mmol
    depletion_time_days = (
        total_equilibrium_gas_mmol / observed_mmol_d
        if observed_mmol_d > 0
        else None
    )

    estimate = None
    if kla_source == "estimate":
        estimate = get_kla_screening_estimate(vessel_class, shaking_rpm, gas_id)
        central_kla_h = estimate["central_kla_h"]
        low_kla_h = estimate["low_kla_h"]
        high_kla_h = estimate["high_kla_h"]
    else:
        central_kla_h = float(custom_kla_h)
        if central_kla_h <= 0:
            raise ValueError("Custom kLa must be larger than zero.")
        low_kla_h = central_kla_h
        high_kla_h = central_kla_h

    low_capacity = _capacity_mmol_d(low_kla_h, liquid_volume_l, c_star_mmol_l)
    central_capacity = _capacity_mmol_d(central_kla_h, liquid_volume_l, c_star_mmol_l)
    high_capacity = _capacity_mmol_d(high_kla_h, liquid_volume_l, c_star_mmol_l)

    def ratio(capacity):
        if capacity == 0:
            return 0.0 if observed_mmol_d == 0 else float("inf")
        return observed_mmol_d / capacity

    low_demand = ratio(low_capacity)
    central_demand = ratio(central_capacity)
    high_demand = ratio(high_capacity)

    if c_star_mmol_l > 0:
        required_kla_h = (
            observed_mmol_d / 24.0
            / (liquid_volume_l * c_star_mmol_l)
        )
    else:
        required_kla_h = 0.0 if observed_mmol_d == 0 else float("inf")

    required_fraction = 1.0 - central_demand
    required_bulk_mmol_l = c_star_mmol_l * required_fraction

    return {
        "gas_id": str(gas_id).strip().upper(),
        "observed_rate_mmol_d": observed_mmol_d,
        "bottle_volume_L": bottle_volume_ml / 1000.0,
        "liquid_volume_L": liquid_volume_l,
        "headspace_volume_L": headspace_volume_l,
        "temperature_K": temperature_k,
        "pressure_bar_abs": pressure_bar_abs,
        "headspace_gas_percent": headspace_gas_percent,
        "headspace_gas_ppmv": headspace_gas_percent * 10000.0,
        "partial_pressure_bar": partial_pressure_pa / BAR_TO_PA,
        "partial_pressure_Pa": partial_pressure_pa,
        "henry_source": henry_source_label,
        "henry_overridden": henry_overridden,
        "henry_reference_Hcp_mol_m3_Pa": henry_reference,
        "henry_B_K": henry_b_k,
        "henry_temperature_corrected_pure_water": henry_pure_water,
        "henry_temperature_corrected": henry_constant,
        "equilibrium_dissolved_mmol_L": c_star_mmol_l,
        "equilibrium_dissolved_umol_L": c_star_umol_l,
        "headspace_gas_mmol": headspace_gas_mmol,
        "equilibrium_dissolved_mmol": equilibrium_dissolved_mmol,
        "total_equilibrium_gas_mmol": total_equilibrium_gas_mmol,
        "estimated_depletion_time_days": depletion_time_days,
        "estimated_depletion_time_hours": None if depletion_time_days is None else depletion_time_days * 24.0,
        "kla_source": kla_source,
        "vessel_class": estimate["vessel_class"] if estimate else None,
        "vessel_label": estimate["vessel_label"] if estimate else None,
        "shaking_rpm": estimate["shaking_rpm"] if estimate else None,
        "kla_literature_note": estimate["literature_basis"]["note"] if estimate and estimate["literature_basis"] else None,
        "kla_literature_citation": estimate["literature_basis"]["citation"] if estimate and estimate["literature_basis"] else None,
        "kla_low_h": low_kla_h,
        "kla_central_h": central_kla_h,
        "kla_high_h": high_kla_h,
        "transfer_capacity_low_mmol_d": low_capacity,
        "transfer_capacity_central_mmol_d": central_capacity,
        "transfer_capacity_high_mmol_d": high_capacity,
        "transfer_demand_ratio_low_kla": low_demand,
        "transfer_demand_ratio_central": central_demand,
        "transfer_demand_ratio_high_kla": high_demand,
        "minimum_required_kla_h": required_kla_h,
        "required_bulk_fraction_of_equilibrium_central": required_fraction,
        "required_bulk_dissolved_mmol_L_central": required_bulk_mmol_l,
        "required_bulk_dissolved_umol_L_central": required_bulk_mmol_l * 1000.0,
        "temperature_warning": check_temperature_range(gas_id, temperature_k),
        "salinity_warning": salinity_result["warning"],
    }
