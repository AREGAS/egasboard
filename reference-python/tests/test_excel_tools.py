import pandas as pd

from excel_tools import make_output_excel


def test_output_excel_is_created():
    results = pd.DataFrame({"sample_id": ["Bottle_01"], "total_bottle_mmol": [1.0]})
    calibration = pd.DataFrame({"gas_id": ["CO"], "r_squared": [0.999]})

    output_bytes = make_output_excel(results, calibration)

    assert isinstance(output_bytes, bytes)
    assert len(output_bytes) > 1000


def test_wide_results_keep_one_row_per_bottle_timepoint():
    from batch_processing import make_wide_results_table

    results = pd.DataFrame(
        [
            {
                "excel_row": 2,
                "experiment_id": "E1",
                "sample_id": "Bottle_01",
                "time_h": 0.0,
                "pressure_bar_abs": 1.0,
                "temperature_C": 25.0,
                "bottle_volume_mL": 120.0,
                "liquid_volume_mL": 50.0,
                "salinity_g_L_NaCl": 0.0,
                "pH": 7.0,
                "gas_id": "CO",
                "peak_area": 100.0,
                "gas_percent": 1.0,
                "total_bottle_mmol": 0.1,
                "headspace_mmol": 0.08,
                "molecular_dissolved_mmol": 0.02,
                "partial_pressure_Pa": 1000.0,
                "estimated_DIC_mmol": None,
                "CO2_star_percent": None,
                "HCO3_percent": None,
                "CO3_percent": None,
                "H2S_percent": None,
                "HS_percent": None,
                "S2_percent": None,
                "speciation_pKa1": None,
                "speciation_pKa2": None,
                "calibration_extrapolated": False,
                "QC_status": "OK",
                "warnings": "",
                "processing_error": "",
            },
            {
                "excel_row": 2,
                "experiment_id": "E1",
                "sample_id": "Bottle_01",
                "time_h": 0.0,
                "pressure_bar_abs": 1.0,
                "temperature_C": 25.0,
                "bottle_volume_mL": 120.0,
                "liquid_volume_mL": 50.0,
                "salinity_g_L_NaCl": 0.0,
                "pH": 7.0,
                "gas_id": "CH4",
                "peak_area": 50.0,
                "gas_percent": 2.0,
                "total_bottle_mmol": 0.2,
                "headspace_mmol": 0.16,
                "molecular_dissolved_mmol": 0.04,
                "partial_pressure_Pa": 2000.0,
                "estimated_DIC_mmol": None,
                "CO2_star_percent": None,
                "HCO3_percent": None,
                "CO3_percent": None,
                "H2S_percent": None,
                "HS_percent": None,
                "S2_percent": None,
                "speciation_pKa1": None,
                "speciation_pKa2": None,
                "calibration_extrapolated": False,
                "QC_status": "OK",
                "warnings": "",
                "processing_error": "",
            },
        ]
    )

    wide = make_wide_results_table(results)
    assert len(wide) == 1
    assert wide.loc[0, "CO_total_bottle_mmol"] == 0.1
    assert wide.loc[0, "CH4_total_bottle_mmol"] == 0.2


def test_calibration_curve_sheet_contains_chart():
    from io import BytesIO
    from zipfile import ZipFile
    from batch_processing import fit_calibrations_from_table

    results = pd.DataFrame(
        [
            {
                "excel_row": 2,
                "experiment_id": "E1",
                "sample_id": "Bottle_01",
                "time_h": 0.0,
                "pressure_bar_abs": 1.0,
                "temperature_C": 25.0,
                "bottle_volume_mL": 120.0,
                "liquid_volume_mL": 50.0,
                "salinity_g_L_NaCl": 0.0,
                "pH": 7.0,
                "gas_id": "CO",
                "peak_area": 100.0,
                "gas_percent": 1.0,
                "total_bottle_mmol": 0.1,
                "headspace_mmol": 0.08,
                "molecular_dissolved_mmol": 0.02,
                "partial_pressure_Pa": 1000.0,
                "estimated_DIC_mmol": None,
                "CO2_star_percent": None,
                "HCO3_percent": None,
                "CO3_percent": None,
                "H2S_percent": None,
                "HS_percent": None,
                "S2_percent": None,
                "speciation_pKa1": None,
                "speciation_pKa2": None,
                "calibration_extrapolated": False,
                "QC_status": "OK",
                "warnings": "",
                "processing_error": "",
            }
        ]
    )
    calibration_table = pd.DataFrame(
        {
            "gas_id": ["CO", "CO", "CO"],
            "calibration_id": ["blank", "std1", "std2"],
            "gas_percent": [0.0, 1.0, 2.0],
            "peak_area": [0.0, 100.0, 200.0],
        }
    )
    calibrations, calibration_summary = fit_calibrations_from_table(calibration_table)

    output_bytes = make_output_excel(
        results,
        calibration_summary,
        calibration_table=calibration_table,
        calibrations=calibrations,
    )

    with ZipFile(BytesIO(output_bytes)) as archive:
        names = archive.namelist()
        assert "xl/charts/chart1.xml" in names
        workbook_xml = archive.read("xl/workbook.xml").decode("utf-8")
        assert 'name="Calibration_curves"' in workbook_xml
