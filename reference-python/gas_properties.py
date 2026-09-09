"""
Gas-property functions for (E)Gasboard.

This file has one simple job:
1. Read the fixed gas-property table from the CSV file.
2. Return the selected properties for one gas.
3. Temperature-correct the Henry solubility using Sander (2023), Eq. 5.

The code is intentionally written in a beginner-friendly way.
"""

import csv
import math
import os


# Reference temperature used by Sander for the tabulated Henry constants.
REFERENCE_TEMPERATURE_K = 298.15


def read_gas_properties():
    """Read data/gas_properties.csv and return a dictionary of gases."""

    # Find the CSV file relative to this Python file.
    current_folder = os.path.dirname(__file__)
    csv_file = os.path.join(current_folder, "data", "gas_properties.csv")

    gases = {}

    with open(csv_file, "r", encoding="utf-8", newline="") as file:
        reader = csv.DictReader(file)

        for row in reader:
            gas_id = row["gas_id"].strip().upper()

            # Empty temperature-range cells are stored as None.
            if row["temp_min_K"].strip() == "":
                temp_min_k = None
            else:
                temp_min_k = float(row["temp_min_K"])

            if row["temp_max_K"].strip() == "":
                temp_max_k = None
            else:
                temp_max_k = float(row["temp_max_K"])

            gases[gas_id] = {
                "gas_id": gas_id,
                "gas_name": row["gas_name"].strip(),
                "cas_rn": row["cas_rn"].strip(),
                "hcp_ref": float(row["hcp_ref_mol_m3_pa"]),
                "B_K": float(row["B_K"]),
                "selected_sander_entry": row["selected_sander_entry"].strip(),
                "temp_min_K": temp_min_k,
                "temp_max_K": temp_max_k,
                "temp_note": row["temp_note"].strip(),
            }

    return gases


# Load the table once when the program starts.
GAS_PROPERTIES = read_gas_properties()


def get_gas_property(gas_id):
    """Return the property dictionary for one gas."""

    gas_id = gas_id.strip().upper()

    if gas_id not in GAS_PROPERTIES:
        supported_gases = ", ".join(GAS_PROPERTIES.keys())
        raise ValueError(
            "Gas '" + gas_id + "' is not available. "
            "Supported gases are: " + supported_gases
        )

    return GAS_PROPERTIES[gas_id]


def calculate_henry_constant(gas_id, temperature_k):
    """Calculate Hcp at the user temperature with Sander Eq. 5."""

    if temperature_k <= 0:
        raise ValueError("Temperature must be above 0 K.")

    gas = get_gas_property(gas_id)

    hcp_reference = gas["hcp_ref"]
    B = gas["B_K"]

    # Sander (2023), Eq. 5:
    # H(T) = H(reference) * exp[B * (1/T - 1/T_reference)]
    temperature_term = (1.0 / temperature_k) - (1.0 / REFERENCE_TEMPERATURE_K)
    exponent = B * temperature_term
    hcp_temperature = hcp_reference * math.exp(exponent)

    return hcp_temperature


def check_temperature_range(gas_id, temperature_k):
    """Return a warning if T lies outside a documented supporting range."""

    gas = get_gas_property(gas_id)
    minimum = gas["temp_min_K"]
    maximum = gas["temp_max_K"]

    if minimum is not None and temperature_k < minimum:
        return (
            f"{gas_id}: {temperature_k:.2f} K is below the documented "
            f"supporting range ({minimum:.2f}-{maximum:.2f} K)."
        )

    if maximum is not None and temperature_k > maximum:
        return (
            f"{gas_id}: {temperature_k:.2f} K is above the documented "
            f"supporting range ({minimum:.2f}-{maximum:.2f} K)."
        )

    return None
