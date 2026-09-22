"""
Batch processing for (E)Gasboard.

The code is intentionally explicit and beginner-friendly.

The workflow is:

1. Check the uploaded tables.
2. Fit one calibration curve for each gas.
3. Loop through the measurement rows one by one.
4. Convert peak area to gas %.
5. Calculate the bottle gas balance.
6. Add simple QC flags.
7. Build first-versus-last summaries and plotting tables.
"""

import math

import pandas as pd

from calibration import calibration_is_extrapolated
from calibration import calculate_gas_percent
from calibration import fit_linear_calibration
from calculations import calculate_gas_state
from gas_properties import GAS_PROPERTIES


# ======================================================================
# EXCEL COLUMNS
# ======================================================================

# One measurement row represents one bottle at one time point.
# Shared bottle conditions are written once. Each gas is a separate column,
# and the value in that gas column is the GC peak area for that gas.
MEASUREMENT_COLUMNS = [
    "sample_id",
    "time_h",
    "pressure_bar_abs",
    "temperature_C",
    "bottle_volume_mL",
    "liquid_volume_mL",
]

OPTIONAL_MEASUREMENT_COLUMNS = [
    "experiment_id",
    "salinity_g_L_NaCl",
    "pH",
    "liquid_sample_mL",
    "headspace_sample_mL",
]

CALIBRATION_COLUMNS = [
    "gas_id",
    "calibration_id",
    "gas_percent",
    "peak_area",
]


def check_required_columns(dataframe, required_columns, table_name):
    """Check that an uploaded table contains all required columns."""

    missing_columns = []

    for column_name in required_columns:
        if column_name not in dataframe.columns:
            missing_columns.append(column_name)

    if len(missing_columns) > 0:
        missing_text = ", ".join(missing_columns)
        raise ValueError(
            table_name
            + " is missing these required columns: "
            + missing_text
        )


def get_measurement_gas_columns(measurement_table):
    """Return recognized gas columns that contain at least one peak area."""

    gas_columns = []

    for gas_id in GAS_PROPERTIES:
        if gas_id in measurement_table.columns:
            if measurement_table[gas_id].notna().any():
                gas_columns.append(gas_id)

    return gas_columns


def measurement_table_to_long(measurement_table):
    """Convert the user-friendly wide measurement table to calculation rows.

    Example input row:
        sample_id | time_h | pressure... | CO | CO2 | CH4

    becomes three internal rows when all three gas columns contain peak areas.
    This conversion is internal only; users work with the wide spreadsheet.
    """

    check_required_columns(
        measurement_table,
        MEASUREMENT_COLUMNS,
        "Measurement file",
    )

    wide_table = measurement_table.copy()

    if "experiment_id" not in wide_table.columns:
        wide_table["experiment_id"] = "Experiment 1"

    if "salinity_g_L_NaCl" not in wide_table.columns:
        wide_table["salinity_g_L_NaCl"] = 0.0

    if "pH" not in wide_table.columns:
        wide_table["pH"] = None

    if "liquid_sample_mL" not in wide_table.columns:
        wide_table["liquid_sample_mL"] = 0.0

    if "headspace_sample_mL" not in wide_table.columns:
        wide_table["headspace_sample_mL"] = 0.0

    gas_columns = get_measurement_gas_columns(wide_table)

    if len(gas_columns) == 0:
        raise ValueError(
            "Measurement file contains no recognized gas peak-area columns. "
            "Use gas names such as CO, CO2, CH4, O2, H2S, N2O, NO, N2 or C2H6 "
            "as column headers."
        )

    long_rows = []

    for row_number, row in wide_table.iterrows():
        for gas_id in gas_columns:
            peak_area = row[gas_id]

            if value_is_missing(peak_area):
                continue

            long_rows.append(
                {
                    "source_excel_row": row_number + 2,
                    "experiment_id": row["experiment_id"],
                    "sample_id": row["sample_id"],
                    "time_h": row["time_h"],
                    "gas_id": gas_id,
                    "peak_area": peak_area,
                    "pressure_bar_abs": row["pressure_bar_abs"],
                    "temperature_C": row["temperature_C"],
                    "bottle_volume_mL": row["bottle_volume_mL"],
                    "liquid_volume_mL": row["liquid_volume_mL"],
                    "liquid_sample_mL": row["liquid_sample_mL"],
                    "headspace_sample_mL": row["headspace_sample_mL"],
                    "salinity_g_L_NaCl": row["salinity_g_L_NaCl"],
                    "pH": row["pH"],
                }
            )

    return pd.DataFrame(long_rows)


def summarize_input_validation(calibration_table, measurement_table):
    """Return only problems or checks that deserve the user's attention."""

    checks = []

    missing_calibration_columns = [
        column_name
        for column_name in CALIBRATION_COLUMNS
        if column_name not in calibration_table.columns
    ]

    missing_measurement_columns = [
        column_name
        for column_name in MEASUREMENT_COLUMNS
        if column_name not in measurement_table.columns
    ]

    if len(missing_calibration_columns) > 0:
        checks.append(
            (
                "ERROR",
                "Calibration file is missing: "
                + ", ".join(missing_calibration_columns),
            )
        )

    if len(missing_measurement_columns) > 0:
        checks.append(
            (
                "ERROR",
                "Measurement file is missing: "
                + ", ".join(missing_measurement_columns),
            )
        )

    gas_columns = get_measurement_gas_columns(measurement_table)

    if len(gas_columns) == 0:
        checks.append(
            (
                "ERROR",
                "No recognized gas peak-area columns were found in the measurement file.",
            )
        )

    if "gas_id" in calibration_table.columns and len(gas_columns) > 0:
        calibration_gases = set(
            calibration_table["gas_id"].dropna().astype(str).str.strip().str.upper()
        )
        gases_without_calibration = sorted(set(gas_columns) - calibration_gases)

        if len(gases_without_calibration) > 0:
            checks.append(
                (
                    "ERROR",
                    "No calibration supplied for: "
                    + ", ".join(gases_without_calibration),
                )
            )

    for row_index, row in measurement_table.iterrows():
        liquid_sample = row.get("liquid_sample_mL", 0.0)
        headspace_sample = row.get("headspace_sample_mL", 0.0)

        if value_is_missing(liquid_sample):
            liquid_sample = 0.0
        if value_is_missing(headspace_sample):
            headspace_sample = 0.0

        try:
            liquid_sample = float(liquid_sample)
            liquid_volume = float(row["liquid_volume_mL"])
            bottle_volume = float(row["bottle_volume_mL"])
            headspace_sample = float(headspace_sample)
            headspace_volume = bottle_volume - liquid_volume
        except (TypeError, ValueError, KeyError):
            continue

        if liquid_sample < 0:
            checks.append((
                "ERROR",
                f"Measurement row {row_index + 2}: liquid_sample_mL must be 0 or a positive number.",
            ))
        elif liquid_sample > liquid_volume:
            checks.append((
                "ERROR",
                f"Measurement row {row_index + 2}: liquid_sample_mL exceeds the liquid volume.",
            ))

        if headspace_sample < 0:
            checks.append((
                "ERROR",
                f"Measurement row {row_index + 2}: headspace_sample_mL must be 0 or a positive number.",
            ))
        elif headspace_sample > headspace_volume:
            checks.append((
                "ERROR",
                f"Measurement row {row_index + 2}: headspace_sample_mL exceeds the headspace volume.",
            ))

    duplicate_columns = ["sample_id", "time_h"]
    if "experiment_id" in measurement_table.columns:
        duplicate_columns.insert(0, "experiment_id")

    if all(column_name in measurement_table.columns for column_name in duplicate_columns):
        duplicate_mask = measurement_table.duplicated(
            subset=duplicate_columns,
            keep=False,
        )
        duplicate_count = int(duplicate_mask.sum())

        if duplicate_count > 0:
            checks.append(
                (
                    "CHECK",
                    str(duplicate_count)
                    + " row(s) share the same experiment/sample/time point. "
                    + "These may be intentional replicate rows.",
                )
            )

    return checks


def fit_calibrations_from_table(calibration_table):
    """Fit one calibration curve for each gas in the calibration table."""

    check_required_columns(
        calibration_table,
        CALIBRATION_COLUMNS,
        "Calibration file",
    )

    calibrations = {}
    summary_rows = []

    gas_ids = calibration_table["gas_id"].dropna().astype(str).str.upper().unique()

    for gas_id in gas_ids:
        gas_rows = calibration_table[
            calibration_table["gas_id"].astype(str).str.upper() == gas_id
        ]

        gas_percent_values = gas_rows["gas_percent"].tolist()
        peak_area_values = gas_rows["peak_area"].tolist()

        calibration = fit_linear_calibration(
            gas_percent_values,
            peak_area_values,
        )

        calibrations[gas_id] = calibration

        summary_rows.append(
            {
                "gas_id": gas_id,
                "mode": calibration["mode"],
                "slope_area_per_percent": calibration["slope"],
                "intercept_area": calibration["intercept"],
                "r_squared": calibration["r_squared"],
                "number_of_points": calibration["number_of_points"],
                "minimum_percent": calibration["minimum_percent"],
                "maximum_percent": calibration["maximum_percent"],
            }
        )

    calibration_summary = pd.DataFrame(summary_rows)

    return calibrations, calibration_summary


def make_calibration_fit_table(calibration_table, gas_id, calibration):
    """Create a small table for visually checking one calibration fit."""

    gas_rows = calibration_table[
        calibration_table["gas_id"].astype(str).str.upper() == str(gas_id).upper()
    ].copy()

    gas_rows = gas_rows.sort_values("gas_percent")

    gas_rows["fitted_peak_area"] = (
        calibration["slope"] * gas_rows["gas_percent"]
        + calibration["intercept"]
    )

    return gas_rows[["gas_percent", "peak_area", "fitted_peak_area"]]


def value_is_missing(value):
    """Return True for empty spreadsheet values such as NaN."""

    if value is None:
        return True

    try:
        return bool(math.isnan(value))
    except TypeError:
        return False


def process_measurement_table(
    measurement_table,
    calibrations,
    compressibility_factor=1.0,
):
    """Process all measurement rows and return a results DataFrame."""

    measurement_table = measurement_table_to_long(measurement_table)

    # Duplicate internal gas rows can arise when the user intentionally enters
    # replicate rows for the same bottle/time point. They are retained and only
    # flagged.
    duplicate_mask = measurement_table.duplicated(
        subset=["experiment_id", "sample_id", "time_h", "gas_id"],
        keep=False,
    )

    result_rows = []

    # Work through the rows one by one. This is intentionally explicit and
    # mirrors the written calculation workflow.
    for row_number, row in measurement_table.iterrows():
        experiment_value = row["experiment_id"]

        if value_is_missing(experiment_value):
            experiment_id = "Experiment 1"
        elif str(experiment_value).strip() == "":
            experiment_id = "Experiment 1"
        else:
            experiment_id = str(experiment_value).strip()

        output_row = {
            "excel_row": row.get("source_excel_row", row_number + 2),
            "experiment_id": experiment_id,
            "sample_id": row["sample_id"],
            "time_h": row["time_h"],
            "gas_id": str(row["gas_id"]).strip().upper(),
            "peak_area": row["peak_area"],
            "pressure_bar_abs": row["pressure_bar_abs"],
            "temperature_C": row["temperature_C"],
            "bottle_volume_mL": row["bottle_volume_mL"],
            "liquid_volume_mL": row["liquid_volume_mL"],
            "liquid_sample_mL": row["liquid_sample_mL"],
            "headspace_sample_mL": row["headspace_sample_mL"],
            "salinity_g_L_NaCl": row["salinity_g_L_NaCl"],
            "pH": row["pH"],
        }

        qc_flags = []

        if bool(duplicate_mask.loc[row_number]):
            qc_flags.append("DUPLICATE_MEASUREMENT")

        try:
            gas_id = output_row["gas_id"]

            if gas_id not in calibrations:
                raise ValueError(
                    "No calibration curve was supplied for " + gas_id + "."
                )

            calibration = calibrations[gas_id]

            # ----------------------------------------------------------
            # STEP A - Convert peak area to gas percentage
            # ----------------------------------------------------------
            gas_percent = calculate_gas_percent(
                row["peak_area"],
                calibration,
            )

            extrapolated = calibration_is_extrapolated(
                gas_percent,
                calibration,
            )

            if extrapolated:
                qc_flags.append("CALIBRATION_EXTRAPOLATION")

            if gas_percent < 0:
                qc_flags.append("NEGATIVE_GAS_PERCENT")

            # ----------------------------------------------------------
            # STEP B - Read salinity and pH
            # ----------------------------------------------------------
            if value_is_missing(row["salinity_g_L_NaCl"]):
                salinity_g_l_nacl = 0.0
            else:
                salinity_g_l_nacl = float(row["salinity_g_L_NaCl"])

            # ----------------------------------------------------------
            # STEP C - Read pH only when a value is present
            # ----------------------------------------------------------
            if value_is_missing(row["pH"]):
                ph = None
            else:
                ph = float(row["pH"])

            if value_is_missing(row["liquid_sample_mL"]):
                liquid_sample_ml = 0.0
            else:
                liquid_sample_ml = float(row["liquid_sample_mL"])

            if value_is_missing(row["headspace_sample_mL"]):
                headspace_sample_ml = 0.0
            else:
                headspace_sample_ml = float(row["headspace_sample_mL"])

            liquid_volume_ml = float(row["liquid_volume_mL"])
            bottle_volume_ml = float(row["bottle_volume_mL"])
            headspace_volume_ml = bottle_volume_ml - liquid_volume_ml

            if liquid_sample_ml < 0:
                raise ValueError("liquid_sample_mL must be 0 or a positive number.")
            if liquid_sample_ml > liquid_volume_ml:
                raise ValueError("liquid_sample_mL cannot exceed liquid_volume_mL.")
            if headspace_sample_ml < 0:
                raise ValueError("headspace_sample_mL must be 0 or a positive number.")
            if headspace_sample_ml > headspace_volume_ml:
                raise ValueError(
                    "headspace_sample_mL cannot exceed the current headspace volume."
                )

            if gas_id in ["CO2", "H2S"] and ph is None:
                qc_flags.append("MISSING_PH")

            # ----------------------------------------------------------
            # STEP D - Calculate the bottle state
            # ----------------------------------------------------------
            result = calculate_gas_state(
                gas_id=gas_id,
                gas_percent=gas_percent,
                pressure_bar_abs=float(row["pressure_bar_abs"]),
                temperature_c=float(row["temperature_C"]),
                bottle_volume_ml=float(row["bottle_volume_mL"]),
                liquid_volume_ml=float(row["liquid_volume_mL"]),
                ph=ph,
                salinity_g_l_nacl=salinity_g_l_nacl,
                compressibility_factor=compressibility_factor,
            )

            # Temperature range warnings originate from the gas-property table.
            for warning_message in result["warnings"]:
                warning_text = str(warning_message).lower()
                if "temperature" in warning_text and "range" in warning_text:
                    qc_flags.append("TEMPERATURE_EXTRAPOLATION")
                if "salting-out parameter" in warning_text or "sechenov" in warning_text:
                    qc_flags.append("SALINITY_MODEL_WARNING")
                if "no weisenberger-schumpe" in warning_text:
                    qc_flags.append("SALINITY_CORRECTION_UNAVAILABLE")

            # ----------------------------------------------------------
            # STEP E - Store the main physical results
            # ----------------------------------------------------------
            output_row["gas_percent"] = gas_percent
            output_row["calibration_extrapolated"] = extrapolated
            output_row["partial_pressure_Pa"] = result["partial_pressure_Pa"]
            output_row["henry_Hcp_mol_m3_Pa"] = result[
                "henry_temperature_corrected"
            ]
            output_row["henry_pure_water_Hcp_mol_m3_Pa"] = result[
                "henry_temperature_corrected_pure_water"
            ]
            output_row["salinity_NaCl_mol_L"] = result["salinity_NaCl_mol_L"]
            output_row["sechenov_K"] = result["sechenov_K"]
            output_row["salting_out_factor"] = result["salting_out_factor"]
            output_row["henry_reference_Hcp_mol_m3_Pa"] = result[
                "henry_reference"
            ]
            output_row["henry_B_K"] = result["henry_B_K"]
            output_row["henry_source"] = result["selected_sander_entry"]
            output_row["compressibility_factor_Z"] = compressibility_factor
            output_row["headspace_mmol"] = result["headspace_mmol"]
            output_row["molecular_dissolved_mmol"] = result[
                "molecular_dissolved_mmol"
            ]
            output_row["reactive_dissolved_mmol"] = result[
                "reactive_dissolved_mmol"
            ]
            output_row["total_bottle_mmol"] = result["total_bottle_mmol"]

            # ----------------------------------------------------------
            # STEP E2 - Keep reactive dissolved pools separate
            # ----------------------------------------------------------
            output_row["estimated_DIC_mmol"] = None
            output_row["estimated_total_sulfide_mmol"] = None

            if gas_id == "CO2" and ph is not None:
                output_row["estimated_DIC_mmol"] = result["estimated_DIC_mmol"]

            if gas_id == "H2S" and ph is not None:
                output_row["estimated_total_sulfide_mmol"] = result[
                    "estimated_total_sulfide_mmol"
                ]

            # ----------------------------------------------------------
            # STEP F - Store speciation fractions when applicable
            # ----------------------------------------------------------
            output_row["CO2_star_percent"] = None
            output_row["HCO3_percent"] = None
            output_row["CO3_percent"] = None
            output_row["H2S_percent"] = None
            output_row["HS_percent"] = None
            output_row["S2_percent"] = None
            output_row["speciation_pKa1"] = None
            output_row["speciation_pKa2"] = None

            if result["speciation"] is not None:
                speciation = result["speciation"]
                output_row["speciation_pKa1"] = speciation["pK1"]
                output_row["speciation_pKa2"] = speciation["pK2"]

                if gas_id == "CO2":
                    output_row["CO2_star_percent"] = (
                        100.0 * speciation["fraction_CO2_star"]
                    )
                    output_row["HCO3_percent"] = (
                        100.0 * speciation["fraction_HCO3"]
                    )
                    output_row["CO3_percent"] = (
                        100.0 * speciation["fraction_CO3"]
                    )

                if gas_id == "H2S":
                    output_row["H2S_percent"] = (
                        100.0 * speciation["fraction_H2S"]
                    )
                    output_row["HS_percent"] = (
                        100.0 * speciation["fraction_HS"]
                    )
                    output_row["S2_percent"] = (
                        100.0 * speciation["fraction_S2"]
                    )

            warning_messages = list(result["warnings"])

            if extrapolated:
                warning_messages.append(
                    "Calculated gas % is outside the calibration range."
                )

            output_row["warnings"] = " | ".join(warning_messages)
            output_row["processing_error"] = ""

        except Exception as error:
            qc_flags.append("ERROR")

            output_row["estimated_DIC_mmol"] = None
            output_row["estimated_total_sulfide_mmol"] = None
            output_row["gas_percent"] = None
            output_row["calibration_extrapolated"] = None
            output_row["partial_pressure_Pa"] = None
            output_row["henry_Hcp_mol_m3_Pa"] = None
            output_row["henry_pure_water_Hcp_mol_m3_Pa"] = None
            output_row["salinity_NaCl_mol_L"] = None
            output_row["sechenov_K"] = None
            output_row["salting_out_factor"] = None
            output_row["henry_reference_Hcp_mol_m3_Pa"] = None
            output_row["henry_B_K"] = None
            output_row["henry_source"] = None
            output_row["CO2_star_percent"] = None
            output_row["HCO3_percent"] = None
            output_row["CO3_percent"] = None
            output_row["H2S_percent"] = None
            output_row["HS_percent"] = None
            output_row["S2_percent"] = None
            output_row["speciation_pKa1"] = None
            output_row["speciation_pKa2"] = None
            output_row["compressibility_factor_Z"] = compressibility_factor
            output_row["headspace_mmol"] = None
            output_row["total_bottle_mmol"] = None
            output_row["CO2_star_percent"] = None
            output_row["HCO3_percent"] = None
            output_row["CO3_percent"] = None
            output_row["H2S_percent"] = None
            output_row["HS_percent"] = None
            output_row["S2_percent"] = None
            output_row["speciation_pKa1"] = None
            output_row["speciation_pKa2"] = None
            output_row["warnings"] = ""
            output_row["processing_error"] = str(error)

        # Remove repeated flags while preserving their order.
        unique_qc_flags = []
        for flag in qc_flags:
            if flag not in unique_qc_flags:
                unique_qc_flags.append(flag)

        if len(unique_qc_flags) == 0:
            output_row["QC_status"] = "OK"
        else:
            output_row["QC_status"] = " | ".join(unique_qc_flags)

        result_rows.append(output_row)

    results_table = pd.DataFrame(result_rows)

    # Keep the result table human-readable. The main scientific outputs in mmol
    # are deliberately placed immediately after the sample identifiers. Detailed
    # calibration, Henry-law and QC information follows afterwards.
    preferred_column_order = [
        "experiment_id",
        "sample_id",
        "time_h",
        "gas_id",
        "total_bottle_mmol",
        "headspace_mmol",
        "molecular_dissolved_mmol",
        "estimated_DIC_mmol",
        "gas_percent",
        "peak_area",
        "pressure_bar_abs",
        "temperature_C",
        "bottle_volume_mL",
        "liquid_volume_mL",
        "liquid_sample_mL",
        "headspace_sample_mL",
        "salinity_g_L_NaCl",
        "pH",
        "partial_pressure_Pa",
        "QC_status",
        "warnings",
        "processing_error",
        "calibration_extrapolated",
        "CO2_star_percent",
        "HCO3_percent",
        "CO3_percent",
        "H2S_percent",
        "HS_percent",
        "S2_percent",
        "speciation_pKa1",
        "speciation_pKa2",
        "henry_Hcp_mol_m3_Pa",
        "henry_pure_water_Hcp_mol_m3_Pa",
        "henry_reference_Hcp_mol_m3_Pa",
        "henry_B_K",
        "henry_source",
        "salinity_NaCl_mol_L",
        "sechenov_K",
        "salting_out_factor",
        "compressibility_factor_Z",
        "excel_row",
    ]

    ordered_columns = []
    for column_name in preferred_column_order:
        if column_name in results_table.columns:
            ordered_columns.append(column_name)

    for column_name in results_table.columns:
        if column_name not in ordered_columns:
            ordered_columns.append(column_name)

    results_table = results_table[ordered_columns]

    return results_table



def _add_qc_flag(row, flag):
    """Append one QC flag while keeping the existing order."""

    current = str(row.get("QC_status", "")).strip()
    existing = []

    if current not in ["", "OK", "nan"]:
        for value in current.split("|"):
            value = value.strip()
            if value and value not in existing:
                existing.append(value)

    if flag not in existing:
        existing.append(flag)

    return " | ".join(existing) if existing else "OK"


def _normalized_experiment_id(value):
    if value_is_missing(value) or str(value).strip() == "":
        return "Experiment 1"
    return str(value).strip()


def apply_sampling_corrections(results_table, measurement_table):
    """Add optional longitudinal sampling-loss corrections.

    Sample volumes on measurement row i are interpreted as being removed after
    the measurement on row i. They therefore affect only later time points.
    The original measured bottle amount is never overwritten.
    """

    if len(results_table) == 0:
        return results_table.copy()

    corrected = results_table.copy()
    source = measurement_table.copy()

    if "experiment_id" not in source.columns:
        source["experiment_id"] = "Experiment 1"
    if "liquid_sample_mL" not in source.columns:
        source["liquid_sample_mL"] = 0.0
    if "headspace_sample_mL" not in source.columns:
        source["headspace_sample_mL"] = 0.0

    source["_excel_row"] = source.index + 2
    source["_experiment_normalized"] = source["experiment_id"].apply(
        _normalized_experiment_id
    )

    # Create the output columns only when needed. This keeps old datasets
    # readable while making the correction explicit when sampling was supplied.
    sampling_columns = [
        "sampled_headspace_mmol",
        "sampled_liquid_molecular_mmol",
        "sampled_total_molecular_mmol",
        "cumulative_sampled_molecular_mmol",
        "sampling_corrected_total_mmol",
        "estimated_total_inorganic_C_bottle_mmol",
        "sampled_DIC_mmol",
        "sampled_total_inorganic_C_mmol",
        "cumulative_sampled_inorganic_C_mmol",
        "estimated_sampling_corrected_total_inorganic_C_mmol",
        "estimated_total_sulfide_bottle_mmol",
        "sampled_dissolved_total_sulfide_mmol",
        "sampled_total_sulfide_mmol",
        "cumulative_sampled_total_sulfide_mmol",
        "estimated_sampling_corrected_total_sulfide_mmol",
    ]
    for column in sampling_columns:
        if column not in corrected.columns:
            corrected[column] = None

    group_keys = source[["_experiment_normalized", "sample_id"]].drop_duplicates()

    for _, group_key in group_keys.iterrows():
        experiment_id = group_key["_experiment_normalized"]
        sample_id = group_key["sample_id"]

        source_rows = source[
            (source["_experiment_normalized"] == experiment_id)
            & (source["sample_id"].astype(str) == str(sample_id))
        ].copy()
        source_rows = source_rows.sort_values(["time_h", "_excel_row"])

        group_has_sampling = False
        for _, source_row in source_rows.iterrows():
            liquid_sample = source_row["liquid_sample_mL"]
            headspace_sample = source_row["headspace_sample_mL"]
            liquid_sample = 0.0 if value_is_missing(liquid_sample) else float(liquid_sample)
            headspace_sample = 0.0 if value_is_missing(headspace_sample) else float(headspace_sample)
            if liquid_sample > 0 or headspace_sample > 0:
                group_has_sampling = True
                break

        if not group_has_sampling:
            continue

        sample_result_mask = (
            corrected["experiment_id"].apply(_normalized_experiment_id) == experiment_id
        ) & (corrected["sample_id"].astype(str) == str(sample_id))

        gas_ids = []
        for gas_id in corrected.loc[sample_result_mask, "gas_id"].astype(str):
            gas_id = gas_id.strip().upper()
            if gas_id not in gas_ids:
                gas_ids.append(gas_id)

        for gas_id in gas_ids:
            cumulative_molecular = 0.0
            molecular_complete = True
            cumulative_reactive = 0.0
            reactive_complete = True

            for _, source_row in source_rows.iterrows():
                excel_row = int(source_row["_excel_row"])
                liquid_sample_ml = source_row["liquid_sample_mL"]
                headspace_sample_ml = source_row["headspace_sample_mL"]
                liquid_sample_ml = 0.0 if value_is_missing(liquid_sample_ml) else float(liquid_sample_ml)
                headspace_sample_ml = 0.0 if value_is_missing(headspace_sample_ml) else float(headspace_sample_ml)
                sampling_occurs = liquid_sample_ml > 0 or headspace_sample_ml > 0

                row_mask = (
                    sample_result_mask
                    & (corrected["gas_id"].astype(str).str.upper() == gas_id)
                    & (corrected["excel_row"].astype(int) == excel_row)
                )
                matching_indices = corrected.index[row_mask].tolist()

                if len(matching_indices) == 0:
                    if sampling_occurs:
                        molecular_complete = False
                        if gas_id in ["CO2", "H2S"]:
                            reactive_complete = False
                    continue

                row_index = matching_indices[0]
                row = corrected.loc[row_index].copy()

                if str(row.get("processing_error", "")).strip() != "":
                    if sampling_occurs:
                        molecular_complete = False
                        if gas_id in ["CO2", "H2S"]:
                            reactive_complete = False
                    continue

                corrected.at[row_index, "cumulative_sampled_molecular_mmol"] = (
                    cumulative_molecular if molecular_complete else None
                )
                corrected.at[row_index, "sampling_corrected_total_mmol"] = (
                    float(row["total_bottle_mmol"]) + cumulative_molecular
                    if molecular_complete
                    else None
                )

                if not molecular_complete:
                    corrected.at[row_index, "QC_status"] = _add_qc_flag(
                        row, "SAMPLING_CORRECTION_INCOMPLETE"
                    )

                liquid_volume_ml = float(row["liquid_volume_mL"])
                headspace_volume_ml = (
                    float(row["bottle_volume_mL"]) - liquid_volume_ml
                )

                sampled_headspace = 0.0
                if headspace_sample_ml > 0:
                    sampled_headspace = (
                        float(row["headspace_mmol"])
                        * headspace_sample_ml
                        / headspace_volume_ml
                    )

                sampled_liquid_molecular = 0.0
                if liquid_sample_ml > 0:
                    sampled_liquid_molecular = (
                        float(row["molecular_dissolved_mmol"])
                        * liquid_sample_ml
                        / liquid_volume_ml
                    )

                sampled_total_molecular = (
                    sampled_headspace + sampled_liquid_molecular
                )

                corrected.at[row_index, "sampled_headspace_mmol"] = sampled_headspace
                corrected.at[row_index, "sampled_liquid_molecular_mmol"] = sampled_liquid_molecular
                corrected.at[row_index, "sampled_total_molecular_mmol"] = sampled_total_molecular

                if gas_id == "CO2":
                    dic_value = row.get("estimated_DIC_mmol")
                    dic_available = not value_is_missing(dic_value)

                    if dic_available:
                        current_tic = float(row["headspace_mmol"]) + float(dic_value)
                        corrected.at[row_index, "estimated_total_inorganic_C_bottle_mmol"] = current_tic
                    else:
                        current_tic = None

                    if reactive_complete and dic_available:
                        corrected.at[row_index, "cumulative_sampled_inorganic_C_mmol"] = cumulative_reactive
                        corrected.at[row_index, "estimated_sampling_corrected_total_inorganic_C_mmol"] = (
                            current_tic + cumulative_reactive
                        )
                    else:
                        corrected.at[row_index, "cumulative_sampled_inorganic_C_mmol"] = None
                        corrected.at[row_index, "estimated_sampling_corrected_total_inorganic_C_mmol"] = None

                    if not reactive_complete:
                        corrected.at[row_index, "QC_status"] = _add_qc_flag(
                            corrected.loc[row_index],
                            "DIC_SAMPLING_CORRECTION_INCOMPLETE",
                        )

                    if liquid_sample_ml > 0 and not dic_available:
                        reactive_complete = False
                        corrected.at[row_index, "QC_status"] = _add_qc_flag(
                            corrected.loc[row_index],
                            "DIC_SAMPLING_CORRECTION_INCOMPLETE",
                        )
                    else:
                        sampled_dic = (
                            float(dic_value) * liquid_sample_ml / liquid_volume_ml
                            if dic_available
                            else 0.0
                        )
                        sampled_tic = sampled_headspace + sampled_dic
                        if dic_available:
                            corrected.at[row_index, "sampled_DIC_mmol"] = sampled_dic
                            corrected.at[row_index, "sampled_total_inorganic_C_mmol"] = sampled_tic
                        if reactive_complete:
                            cumulative_reactive += sampled_tic

                if gas_id == "H2S":
                    sulfide_value = row.get("estimated_total_sulfide_mmol")
                    sulfide_available = not value_is_missing(sulfide_value)

                    if sulfide_available:
                        current_total_sulfide = (
                            float(row["headspace_mmol"]) + float(sulfide_value)
                        )
                        corrected.at[row_index, "estimated_total_sulfide_bottle_mmol"] = current_total_sulfide
                    else:
                        current_total_sulfide = None

                    if reactive_complete and sulfide_available:
                        corrected.at[row_index, "cumulative_sampled_total_sulfide_mmol"] = cumulative_reactive
                        corrected.at[row_index, "estimated_sampling_corrected_total_sulfide_mmol"] = (
                            current_total_sulfide + cumulative_reactive
                        )
                    else:
                        corrected.at[row_index, "cumulative_sampled_total_sulfide_mmol"] = None
                        corrected.at[row_index, "estimated_sampling_corrected_total_sulfide_mmol"] = None

                    if not reactive_complete:
                        corrected.at[row_index, "QC_status"] = _add_qc_flag(
                            corrected.loc[row_index],
                            "TOTAL_SULFIDE_SAMPLING_CORRECTION_INCOMPLETE",
                        )

                    if liquid_sample_ml > 0 and not sulfide_available:
                        reactive_complete = False
                        corrected.at[row_index, "QC_status"] = _add_qc_flag(
                            corrected.loc[row_index],
                            "TOTAL_SULFIDE_SAMPLING_CORRECTION_INCOMPLETE",
                        )
                    else:
                        sampled_dissolved_sulfide = (
                            float(sulfide_value)
                            * liquid_sample_ml
                            / liquid_volume_ml
                            if sulfide_available
                            else 0.0
                        )
                        sampled_total_sulfide = (
                            sampled_headspace + sampled_dissolved_sulfide
                        )
                        if sulfide_available:
                            corrected.at[row_index, "sampled_dissolved_total_sulfide_mmol"] = sampled_dissolved_sulfide
                            corrected.at[row_index, "sampled_total_sulfide_mmol"] = sampled_total_sulfide
                        if reactive_complete:
                            cumulative_reactive += sampled_total_sulfide

                if molecular_complete:
                    cumulative_molecular += sampled_total_molecular

    return corrected


def make_wide_results_table(results_table):
    """Return one user-facing row per original bottle/time-point measurement.

    Calculations stay in long format internally because that is simpler and safer
    for per-gas processing. This helper reshapes the final output back to the same
    wide structure users supplied: shared bottle conditions once, followed by
    gas-specific result columns.
    """

    if len(results_table) == 0:
        return pd.DataFrame()

    # Keep the helper tolerant of small synthetic/test tables that are already
    # effectively user-facing rather than full internal calculation output.
    required_internal_columns = {"excel_row", "gas_id"}
    if not required_internal_columns.issubset(set(results_table.columns)):
        return results_table.copy()

    results_table = results_table.copy()
    if "liquid_sample_mL" not in results_table.columns:
        results_table["liquid_sample_mL"] = 0.0
    if "headspace_sample_mL" not in results_table.columns:
        results_table["headspace_sample_mL"] = 0.0

    shared_columns = [
        "excel_row",
        "experiment_id",
        "sample_id",
        "time_h",
        "pressure_bar_abs",
        "temperature_C",
        "bottle_volume_mL",
        "liquid_volume_mL",
        "liquid_sample_mL",
        "headspace_sample_mL",
        "salinity_g_L_NaCl",
        "pH",
    ]

    gas_metric_columns = [
        "peak_area",
        "gas_percent",
        "total_bottle_mmol",
        "headspace_mmol",
        "molecular_dissolved_mmol",
        "reactive_dissolved_mmol",
        "partial_pressure_Pa",
        "estimated_DIC_mmol",
        "estimated_total_sulfide_mmol",
        "sampled_headspace_mmol",
        "sampled_liquid_molecular_mmol",
        "sampled_total_molecular_mmol",
        "cumulative_sampled_molecular_mmol",
        "sampling_corrected_total_mmol",
        "estimated_total_inorganic_C_bottle_mmol",
        "sampled_DIC_mmol",
        "sampled_total_inorganic_C_mmol",
        "cumulative_sampled_inorganic_C_mmol",
        "estimated_sampling_corrected_total_inorganic_C_mmol",
        "estimated_total_sulfide_bottle_mmol",
        "sampled_dissolved_total_sulfide_mmol",
        "sampled_total_sulfide_mmol",
        "cumulative_sampled_total_sulfide_mmol",
        "estimated_sampling_corrected_total_sulfide_mmol",
        "CO2_star_percent",
        "HCO3_percent",
        "CO3_percent",
        "H2S_percent",
        "HS_percent",
        "S2_percent",
        "speciation_pKa1",
        "speciation_pKa2",
        "calibration_extrapolated",
        "QC_status",
        "warnings",
        "processing_error",
    ]

    # Preserve the input-row order rather than sorting identifiers alphabetically.
    source_rows = (
        results_table[shared_columns]
        .drop_duplicates(subset=["excel_row"], keep="first")
        .sort_values("excel_row")
        .reset_index(drop=True)
    )

    wide_table = source_rows.copy()

    gas_order = []
    for gas_id in results_table["gas_id"].astype(str):
        gas_id = gas_id.strip().upper()
        if gas_id not in gas_order:
            gas_order.append(gas_id)

    for gas_id in gas_order:
        gas_rows = results_table[
            results_table["gas_id"].astype(str).str.upper() == gas_id
        ].copy()

        gas_rows = gas_rows.set_index("excel_row")

        for metric_name in gas_metric_columns:
            if metric_name not in gas_rows.columns:
                continue

            # Skip columns that are completely empty for this gas. This prevents,
            # for example, H2S speciation columns appearing in a CO-only dataset.
            if gas_rows[metric_name].isna().all():
                continue

            output_name = gas_id + "_" + metric_name
            wide_table[output_name] = wide_table["excel_row"].map(
                gas_rows[metric_name]
            )

    # excel_row is useful internally but does not need to lead the user output.
    output_columns = [
        "experiment_id",
        "sample_id",
        "time_h",
        "pressure_bar_abs",
        "temperature_C",
        "bottle_volume_mL",
        "liquid_volume_mL",
        "liquid_sample_mL",
        "headspace_sample_mL",
        "salinity_g_L_NaCl",
        "pH",
    ]

    for column_name in wide_table.columns:
        if column_name not in output_columns and column_name != "excel_row":
            output_columns.append(column_name)

    return wide_table[output_columns]



def make_compact_results_table(results_table):
    """Return a concise wide table for normal user-facing output.

    One row represents one bottle/time point. Shared bottle conditions are
    shown once. For each measured gas, the normal result contains:
    total bottle amount, headspace amount and liquid amount.

    CO2 and H2S retain the additional chemically relevant outputs.
    The exhaustive calculation fields remain available separately through
    make_wide_results_table().
    """

    if len(results_table) == 0:
        return pd.DataFrame()

    required_internal_columns = {"excel_row", "gas_id"}
    if not required_internal_columns.issubset(set(results_table.columns)):
        return results_table.copy()

    results_table = results_table.copy()
    if "liquid_sample_mL" not in results_table.columns:
        results_table["liquid_sample_mL"] = 0.0
    if "headspace_sample_mL" not in results_table.columns:
        results_table["headspace_sample_mL"] = 0.0

    shared_columns = [
        "excel_row",
        "experiment_id",
        "sample_id",
        "time_h",
        "pressure_bar_abs",
        "temperature_C",
        "bottle_volume_mL",
        "liquid_volume_mL",
        "salinity_g_L_NaCl",
        "pH",
    ]

    source_rows = (
        results_table[shared_columns]
        .drop_duplicates(subset=["excel_row"], keep="first")
        .sort_values("excel_row")
        .reset_index(drop=True)
    )

    compact = source_rows.copy()

    gas_order = []
    for gas_id in results_table["gas_id"].astype(str):
        gas_id = gas_id.strip().upper()
        if gas_id not in gas_order:
            gas_order.append(gas_id)

    for gas_id in gas_order:
        gas_rows = results_table[
            results_table["gas_id"].astype(str).str.upper() == gas_id
        ].copy().set_index("excel_row")

        # Core output for every gas.
        # Gas percentage is retained because it is a directly calibrated
        # measurement and is useful for plotting without duplicating data.
        core_metrics = [
            ("gas_percent", "gas_percent"),
            ("total_bottle_mmol", "total_mmol"),
            ("headspace_mmol", "headspace_mmol"),
        ]

        for source_metric, output_suffix in core_metrics:
            if source_metric not in gas_rows.columns:
                continue

            compact[gas_id + "_" + output_suffix] = compact["excel_row"].map(
                gas_rows[source_metric]
            )

        liquid_source = None
        for candidate in [
            "molecular_dissolved_mmol",
        ]:
            if candidate in gas_rows.columns:
                liquid_source = candidate
                break

        if liquid_source is not None:
            compact[gas_id + "_liquid_mmol"] = compact["excel_row"].map(
                gas_rows[liquid_source]
            )

        if "sampling_corrected_total_mmol" in gas_rows.columns:
            if not gas_rows["sampling_corrected_total_mmol"].isna().all():
                compact[gas_id + "_sampling_corrected_total_mmol"] = compact[
                    "excel_row"
                ].map(gas_rows["sampling_corrected_total_mmol"])
                compact[gas_id + "_cumulative_sampled_mmol"] = compact[
                    "excel_row"
                ].map(gas_rows["cumulative_sampled_molecular_mmol"])

        # Partial pressure varies by bottle/time point, so it belongs with
        # measurement results rather than static metadata.
        if "partial_pressure_Pa" in gas_rows.columns:
            compact[gas_id + "_partial_pressure_bar"] = compact["excel_row"].map(
                gas_rows["partial_pressure_Pa"] / 100000.0
            )

        # CO2-specific interpretation.
        # Keep the normal Results sheet concise: physical CO2 and estimated DIC
        # are the two main additional mmol quantities. Detailed carbonate
        # species remain available in Extended_data.
        if gas_id == "CO2":
            optional_metrics = [
                ("estimated_DIC_mmol", "estimated_DIC_mmol"),
                (
                    "estimated_total_inorganic_C_bottle_mmol",
                    "estimated_total_inorganic_C_bottle_mmol",
                ),
                (
                    "estimated_sampling_corrected_total_inorganic_C_mmol",
                    "estimated_sampling_corrected_total_inorganic_C_mmol",
                ),
            ]

            for source_metric, output_suffix in optional_metrics:
                if source_metric in gas_rows.columns:
                    if not gas_rows[source_metric].isna().all():
                        compact[gas_id + "_" + output_suffix] = compact[
                            "excel_row"
                        ].map(gas_rows[source_metric])

        # H2S-specific interpretation.
        if gas_id == "H2S":
            optional_metrics = [
                ("estimated_total_sulfide_mmol", "estimated_total_sulfide_mmol"),
                (
                    "estimated_total_sulfide_bottle_mmol",
                    "estimated_total_sulfide_bottle_mmol",
                ),
                (
                    "estimated_sampling_corrected_total_sulfide_mmol",
                    "estimated_sampling_corrected_total_sulfide_mmol",
                ),
                ("H2S_percent", "H2S_percent"),
                ("HS_percent", "HS_percent"),
                ("S2_percent", "S2_percent"),
            ]

            for source_metric, output_suffix in optional_metrics:
                if source_metric in gas_rows.columns:
                    if not gas_rows[source_metric].isna().all():
                        compact[gas_id + "_" + output_suffix] = compact[
                            "excel_row"
                        ].map(gas_rows[source_metric])

    output_columns = [
        "experiment_id",
        "sample_id",
        "time_h",
        "pressure_bar_abs",
        "temperature_C",
        "bottle_volume_mL",
        "liquid_volume_mL",
        "salinity_g_L_NaCl",
        "pH",
    ]

    for column_name in compact.columns:
        if column_name not in output_columns and column_name != "excel_row":
            output_columns.append(column_name)

    return compact[output_columns]

def make_single_gas_plot_table(results_table, sample_id, gas_id):
    """Prepare one sample and one gas for the normal time-series plots."""

    selected_rows = results_table[
        (results_table["sample_id"].astype(str) == str(sample_id))
        & (results_table["gas_id"].astype(str) == str(gas_id))
    ].copy()

    selected_rows = selected_rows.sort_values("time_h")
    selected_rows = selected_rows.set_index("time_h")

    return selected_rows


def make_absolute_gas_comparison_table(results_table, sample_id):
    """Create one table with total bottle mmol for all gases through time."""

    sample_rows = results_table[
        results_table["sample_id"].astype(str) == str(sample_id)
    ].copy()

    if len(sample_rows) == 0:
        return pd.DataFrame()

    comparison_table = sample_rows.pivot_table(
        index="time_h",
        columns="gas_id",
        values="total_bottle_mmol",
        aggfunc="mean",
    )

    comparison_table = comparison_table.sort_index()

    return comparison_table


def make_gas_percent_comparison_table(results_table, sample_id):
    """Create one table with gas % for all gases through time."""

    sample_rows = results_table[
        results_table["sample_id"].astype(str) == str(sample_id)
    ].copy()

    if len(sample_rows) == 0:
        return pd.DataFrame()

    comparison_table = sample_rows.pivot_table(
        index="time_h",
        columns="gas_id",
        values="gas_percent",
        aggfunc="mean",
    )

    comparison_table = comparison_table.sort_index()

    return comparison_table


def make_normalized_gas_comparison_table(results_table, sample_id):
    """Normalize every gas time series to its own first measured value."""

    absolute_table = make_absolute_gas_comparison_table(
        results_table,
        sample_id,
    )

    if len(absolute_table) == 0:
        return pd.DataFrame()

    normalized_table = absolute_table.copy()

    for gas_id in absolute_table.columns:
        gas_values = absolute_table[gas_id].dropna()

        if len(gas_values) == 0:
            continue

        initial_value = float(gas_values.iloc[0])

        if initial_value == 0:
            normalized_table[gas_id] = float("nan")
            continue

        normalized_table[gas_id] = (
            absolute_table[gas_id] / initial_value * 100.0
        )

    return normalized_table
