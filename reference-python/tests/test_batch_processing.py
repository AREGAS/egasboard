import pandas as pd

from batch_processing import fit_calibrations_from_table
from batch_processing import make_absolute_gas_comparison_table
from batch_processing import make_compact_results_table
from batch_processing import make_gas_percent_comparison_table
from batch_processing import make_normalized_gas_comparison_table
from batch_processing import process_measurement_table
from batch_processing import summarize_input_validation


def test_batch_processing():
    calibration_table = pd.DataFrame(
        {
            "gas_id": ["CO", "CO", "CO", "CO"],
            "calibration_id": ["CO_0", "CO_5", "CO_10", "CO_20"],
            "gas_percent": [0.0, 5.0, 10.0, 20.0],
            "peak_area": [500.0, 50500.0, 100500.0, 200500.0],
        }
    )

    measurement_table = pd.DataFrame(
        {
            "sample_id": ["Bottle_01", "Bottle_01"],
            "time_h": [0.0, 24.0],
            "CO": [150500.0, 80500.0],
            "pressure_bar_abs": [1.50, 1.35],
            "temperature_C": [30.0, 30.0],
            "bottle_volume_mL": [120.0, 120.0],
            "liquid_volume_mL": [50.0, 50.0],
            "salinity_g_L_NaCl": [0.0, 0.0],
            "pH": [None, None],
        }
    )

    calibrations, calibration_summary = fit_calibrations_from_table(
        calibration_table
    )

    results = process_measurement_table(
        measurement_table,
        calibrations,
        compressibility_factor=1.0,
    )

    assert len(calibration_summary) == 1
    assert len(results) == 2
    assert results["processing_error"].tolist() == ["", ""]
    assert abs(results.iloc[0]["gas_percent"] - 15.0) < 0.001
    assert abs(results.iloc[1]["gas_percent"] - 8.0) < 0.001


def test_experiments_are_kept_separate():
    calibration_table = pd.DataFrame(
        {
            "gas_id": ["CO", "CO"],
            "calibration_id": ["CO_0", "CO_10"],
            "gas_percent": [0.0, 10.0],
            "peak_area": [500.0, 100500.0],
        }
    )

    measurement_table = pd.DataFrame(
        {
            "experiment_id": ["Experiment_A", "Experiment_A", "Experiment_B", "Experiment_B"],
            "sample_id": ["Bottle_01", "Bottle_01", "Bottle_01", "Bottle_01"],
            "time_h": [0.0, 24.0, 0.0, 24.0],
            "CO": [100500.0, 50500.0, 80500.0, 40500.0],
            "pressure_bar_abs": [1.5, 1.4, 1.5, 1.4],
            "temperature_C": [30.0, 30.0, 30.0, 30.0],
            "bottle_volume_mL": [120.0, 120.0, 120.0, 120.0],
            "liquid_volume_mL": [50.0, 50.0, 50.0, 50.0],
            "salinity_g_L_NaCl": [0.0, 0.0, 0.0, 0.0],
            "pH": [None, None, None, None],
        }
    )

    calibrations, _ = fit_calibrations_from_table(calibration_table)
    results = process_measurement_table(measurement_table, calibrations)
    assert sorted(results["experiment_id"].unique().tolist()) == [
        "Experiment_A",
        "Experiment_B",
    ]


def test_multi_gas_plot_tables():
    results = pd.DataFrame(
        {
            "sample_id": ["Bottle_01", "Bottle_01", "Bottle_01", "Bottle_01"],
            "time_h": [0.0, 24.0, 0.0, 24.0],
            "gas_id": ["CO", "CO", "CH4", "CH4"],
            "gas_percent": [10.0, 5.0, 2.0, 3.0],
            "total_bottle_mmol": [1.0, 0.5, 0.2, 0.3],
        }
    )

    absolute = make_absolute_gas_comparison_table(results, "Bottle_01")
    normalized = make_normalized_gas_comparison_table(results, "Bottle_01")
    gas_percent = make_gas_percent_comparison_table(results, "Bottle_01")

    assert list(absolute.columns) == ["CH4", "CO"]
    assert abs(absolute.loc[24.0, "CO"] - 0.5) < 0.000001
    assert abs(normalized.loc[0.0, "CO"] - 100.0) < 0.000001
    assert abs(normalized.loc[24.0, "CO"] - 50.0) < 0.000001
    assert abs(normalized.loc[24.0, "CH4"] - 150.0) < 0.000001
    assert abs(gas_percent.loc[24.0, "CH4"] - 3.0) < 0.000001


def test_validation_and_qc_flags_duplicates():
    calibration_table = pd.DataFrame(
        {
            "gas_id": ["CO", "CO"],
            "calibration_id": ["CO_0", "CO_10"],
            "gas_percent": [0.0, 10.0],
            "peak_area": [500.0, 100500.0],
        }
    )

    measurement_table = pd.DataFrame(
        {
            "experiment_id": ["A", "A"],
            "sample_id": ["Bottle_01", "Bottle_01"],
            "time_h": [0.0, 0.0],
            "CO": [100500.0, 100500.0],
            "pressure_bar_abs": [1.5, 1.5],
            "temperature_C": [30.0, 30.0],
            "bottle_volume_mL": [120.0, 120.0],
            "liquid_volume_mL": [50.0, 50.0],
            "salinity_g_L_NaCl": [0.0, 0.0],
            "pH": [None, None],
        }
    )

    checks = summarize_input_validation(calibration_table, measurement_table)
    assert any(status == "CHECK" for status, _ in checks)

    calibrations, _ = fit_calibrations_from_table(calibration_table)
    results = process_measurement_table(measurement_table, calibrations)
    assert all("DUPLICATE_MEASUREMENT" in value for value in results["QC_status"])


def test_optional_measurement_columns_can_be_omitted():
    calibration_table = pd.DataFrame(
        {
            "gas_id": ["CO", "CO"],
            "calibration_id": ["CO_0", "CO_10"],
            "gas_percent": [0.0, 10.0],
            "peak_area": [500.0, 100500.0],
        }
    )

    measurement_table = pd.DataFrame(
        {
            "sample_id": ["Bottle_01"],
            "time_h": [0.0],
            "CO": [100500.0],
            "pressure_bar_abs": [1.5],
            "temperature_C": [30.0],
            "bottle_volume_mL": [120.0],
            "liquid_volume_mL": [50.0],
        }
    )

    checks = summarize_input_validation(calibration_table, measurement_table)
    assert not any(status == "ERROR" for status, _ in checks)

    calibrations, _ = fit_calibrations_from_table(calibration_table)
    results = process_measurement_table(measurement_table, calibrations)

    assert results.iloc[0]["experiment_id"] == "Experiment 1"
    assert results.iloc[0]["salinity_g_L_NaCl"] == 0.0
    assert results.iloc[0]["processing_error"] == ""


def test_wide_measurement_row_expands_to_multiple_gases():
    calibration_table = pd.DataFrame(
        {
            "gas_id": ["CO", "CO", "CH4", "CH4"],
            "calibration_id": ["CO_0", "CO_10", "CH4_0", "CH4_10"],
            "gas_percent": [0.0, 10.0, 0.0, 10.0],
            "peak_area": [0.0, 100000.0, 0.0, 50000.0],
        }
    )

    measurement_table = pd.DataFrame(
        {
            "sample_id": ["Bottle_01"],
            "time_h": [0.0],
            "pressure_bar_abs": [1.0],
            "temperature_C": [25.0],
            "bottle_volume_mL": [120.0],
            "liquid_volume_mL": [50.0],
            "CO": [50000.0],
            "CH4": [25000.0],
        }
    )

    checks = summarize_input_validation(calibration_table, measurement_table)
    assert checks == []

    calibrations, _ = fit_calibrations_from_table(calibration_table)
    results = process_measurement_table(measurement_table, calibrations)

    assert len(results) == 2
    assert sorted(results["gas_id"].tolist()) == ["CH4", "CO"]


def test_co2_physical_and_dic_are_separate():
    calibration_table = pd.DataFrame(
        {
            "gas_id": ["CO2", "CO2"],
            "calibration_id": ["CO2_0", "CO2_10"],
            "gas_percent": [0.0, 10.0],
            "peak_area": [0.0, 1000.0],
        }
    )

    measurement_table = pd.DataFrame(
        {
            "sample_id": ["Bottle_01"],
            "time_h": [0.0],
            "pressure_bar_abs": [1.0],
            "temperature_C": [25.0],
            "bottle_volume_mL": [120.0],
            "liquid_volume_mL": [50.0],
            "pH": [7.0],
            "CO2": [500.0],
        }
    )

    calibrations, _ = fit_calibrations_from_table(calibration_table)
    results = process_measurement_table(measurement_table, calibrations)

    row = results.iloc[0]

    assert row["total_bottle_mmol"] > 0
    assert row["estimated_DIC_mmol"] > 0



def test_compact_results_table_keeps_core_gas_amounts():
    import pandas as pd

    internal = pd.DataFrame(
        [
            {
                "excel_row": 2,
                "experiment_id": "E1",
                "sample_id": "S1",
                "time_h": 0.0,
                "pressure_bar_abs": 1.0,
                "temperature_C": 25.0,
                "bottle_volume_mL": 120.0,
                "liquid_volume_mL": 50.0,
                "salinity_g_L_NaCl": 0.0,
                "pH": 7.0,
                "gas_id": "CO",
                "total_bottle_mmol": 0.10,
                "headspace_mmol": 0.08,
                "molecular_dissolved_mmol": 0.02,
            },
            {
                "excel_row": 2,
                "experiment_id": "E1",
                "sample_id": "S1",
                "time_h": 0.0,
                "pressure_bar_abs": 1.0,
                "temperature_C": 25.0,
                "bottle_volume_mL": 120.0,
                "liquid_volume_mL": 50.0,
                "salinity_g_L_NaCl": 0.0,
                "pH": 7.0,
                "gas_id": "CH4",
                "total_bottle_mmol": 0.20,
                "headspace_mmol": 0.15,
                "molecular_dissolved_mmol": 0.05,
            },
        ]
    )

    compact = make_compact_results_table(internal)

    assert len(compact) == 1
    assert compact.loc[0, "CO_total_mmol"] == 0.10
    assert compact.loc[0, "CO_headspace_mmol"] == 0.08
    assert compact.loc[0, "CO_liquid_mmol"] == 0.02
    assert compact.loc[0, "CH4_total_mmol"] == 0.20



def test_compact_co2_output_is_concise():
    internal = pd.DataFrame(
        [
            {
                "excel_row": 2,
                "experiment_id": "E1",
                "sample_id": "S1",
                "time_h": 0.0,
                "pressure_bar_abs": 1.0,
                "temperature_C": 25.0,
                "bottle_volume_mL": 120.0,
                "liquid_volume_mL": 50.0,
                "salinity_g_L_NaCl": 0.0,
                "pH": 7.0,
                "gas_id": "CO2",
                "total_bottle_mmol": 0.50,
                "headspace_mmol": 0.20,
                "molecular_dissolved_mmol": 0.30,
                "estimated_DIC_mmol": 0.30,
                "CO2_star_percent": 18.0,
                "HCO3_percent": 80.0,
                "CO3_percent": 2.0,
            }
        ]
    )

    compact = make_compact_results_table(internal)

    assert "CO2_total_mmol" in compact.columns
    assert "CO2_estimated_DIC_mmol" in compact.columns
    assert "CO2_CO2_star_percent" not in compact.columns
    assert "CO2_HCO3_percent" not in compact.columns
    assert "CO2_CO3_percent" not in compact.columns



def test_compact_results_include_partial_pressure_bar():
    internal = pd.DataFrame(
        [
            {
                "excel_row": 2,
                "experiment_id": "E1",
                "sample_id": "S1",
                "time_h": 0.0,
                "pressure_bar_abs": 1.5,
                "temperature_C": 25.0,
                "bottle_volume_mL": 120.0,
                "liquid_volume_mL": 50.0,
                "salinity_g_L_NaCl": 0.0,
                "pH": 7.0,
                "gas_id": "CO",
                "partial_pressure_Pa": 15000.0,
                "total_bottle_mmol": 0.10,
                "headspace_mmol": 0.08,
                "molecular_dissolved_mmol": 0.02,
            }
        ]
    )

    compact = make_compact_results_table(internal)

    assert compact.loc[0, "CO_partial_pressure_bar"] == 0.15



def test_compact_results_include_plot_source_values():
    internal = pd.DataFrame(
        [
            {
                "excel_row": 2,
                "experiment_id": "E1",
                "sample_id": "S1",
                "time_h": 0.0,
                "pressure_bar_abs": 1.5,
                "temperature_C": 25.0,
                "bottle_volume_mL": 120.0,
                "liquid_volume_mL": 50.0,
                "salinity_g_L_NaCl": 0.0,
                "pH": 7.0,
                "gas_id": "CO",
                "gas_percent": 10.0,
                "partial_pressure_Pa": 15000.0,
                "total_bottle_mmol": 0.10,
                "headspace_mmol": 0.08,
                "molecular_dissolved_mmol": 0.02,
            }
        ]
    )

    compact = make_compact_results_table(internal)

    assert compact.loc[0, "CO_gas_percent"] == 10.0
    assert compact.loc[0, "CO_partial_pressure_bar"] == 0.15
