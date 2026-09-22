"""
Excel helpers for (E)Gasboard.

The calculation engine works internally with one row per gas because that makes
per-gas calculations clear. Exported workbooks are reshaped
back to the user-facing wide format: one row per bottle/time point.
"""

from io import BytesIO

import pandas as pd

from batch_processing import (
    make_calibration_fit_table,
    make_compact_results_table,
    make_wide_results_table,
)
from gas_properties import GAS_PROPERTIES


def read_excel_file(uploaded_file):
    """Read the first sheet from one uploaded Excel file."""

    dataframe = pd.read_excel(uploaded_file)
    return dataframe


def _make_calibration_data_table(calibration_table, calibrations):
    """Create one non-duplicated table used by the calibration chart sheet."""

    rows = []

    for gas_id in calibration_table["gas_id"].dropna().astype(str).str.upper().unique():
        model = calibrations[gas_id]
        fit_table = make_calibration_fit_table(
            calibration_table,
            gas_id,
            model,
        )

        source_rows = calibration_table[
            calibration_table["gas_id"].astype(str).str.upper() == gas_id
        ].reset_index(drop=True)

        for row_index, fit_row in enumerate(fit_table.itertuples(index=False)):
            calibration_id = ""
            if "calibration_id" in source_rows.columns and row_index < len(source_rows):
                calibration_id = source_rows.iloc[row_index]["calibration_id"]

            rows.append(
                {
                    "gas_id": gas_id,
                    "calibration_id": calibration_id,
                    "gas_percent": float(fit_row.gas_percent),
                    "peak_area": float(fit_row.peak_area),
                    "fitted_peak_area": float(fit_row.fitted_peak_area),
                    "model": model["mode"],
                    "slope_area_per_percent": model["slope"],
                    "intercept_area": model["intercept"],
                    "r_squared": model["r_squared"],
                    "n_points": model["number_of_points"],
                    "calibration_min_percent": model["minimum_percent"],
                    "calibration_max_percent": model["maximum_percent"],
                }
            )

    return pd.DataFrame(rows)


def _write_calibration_curves_sheet(
    writer,
    calibration_data,
):
    """Create a chart-only calibration sheet referencing Calibration_data."""

    workbook = writer.book
    sheet_name = "Calibration_curves"
    data_sheet_name = "Calibration_data"
    worksheet = workbook.add_worksheet(sheet_name)
    writer.sheets[sheet_name] = worksheet

    green = "#245F3D"
    title_format = workbook.add_format(
        {"bold": True, "font_size": 16, "font_color": green}
    )
    subtitle_format = workbook.add_format(
        {"font_color": "#66736A"}
    )

    worksheet.write(0, 0, "Calibration curves", title_format)
    worksheet.write(
        1,
        0,
        "Observed calibration points and fitted lines. Source values are stored once in Calibration_data.",
        subtitle_format,
    )

    required_columns = {
        "gas_id",
        "gas_percent",
        "peak_area",
        "fitted_peak_area",
        "slope_area_per_percent",
        "intercept_area",
        "r_squared",
    }

    if len(calibration_data) == 0 or not required_columns.issubset(
        set(calibration_data.columns)
    ):
        worksheet.write(
            3,
            0,
            "Calibration plot data are unavailable for this simplified workbook.",
        )
        return

    gas_ids = list(dict.fromkeys(calibration_data["gas_id"].astype(str).tolist()))
    chart_row = 4

    for gas_id in gas_ids:
        gas_rows = calibration_data[
            calibration_data["gas_id"].astype(str) == gas_id
        ]

        first_index = gas_rows.index.min()
        last_index = gas_rows.index.max()

        # Excel rows: row 0 header, dataframe starts row 1.
        first_excel_row = first_index + 1
        last_excel_row = last_index + 1

        model = gas_rows.iloc[0]
        equation = f'A = {float(model["slope_area_per_percent"]):.5g}x'
        intercept = float(model["intercept_area"])

        if abs(intercept) > 1e-12:
            if intercept >= 0:
                equation += f' + {intercept:.5g}'
            else:
                equation += f' - {abs(intercept):.5g}'

        if pd.notna(model["r_squared"]):
            equation += f'   R² = {float(model["r_squared"]):.4f}'

        chart = workbook.add_chart(
            {"type": "scatter", "subtype": "straight_with_markers"}
        )

        # Calibration_data columns:
        # A gas_id, B calibration_id, C gas_percent,
        # D peak_area, E fitted_peak_area
        chart.add_series(
            {
                "name": "Calibration points",
                "categories": [
                    data_sheet_name,
                    first_excel_row,
                    2,
                    last_excel_row,
                    2,
                ],
                "values": [
                    data_sheet_name,
                    first_excel_row,
                    3,
                    last_excel_row,
                    3,
                ],
                "marker": {
                    "type": "circle",
                    "size": 6,
                    "border": {"color": green},
                    "fill": {"color": green},
                },
                "line": {"none": True},
            }
        )

        chart.add_series(
            {
                "name": "Fitted line",
                "categories": [
                    data_sheet_name,
                    first_excel_row,
                    2,
                    last_excel_row,
                    2,
                ],
                "values": [
                    data_sheet_name,
                    first_excel_row,
                    4,
                    last_excel_row,
                    4,
                ],
                "marker": {"type": "none"},
                "line": {"color": green, "width": 2},
            }
        )

        chart.set_title({"name": f"{gas_id}: {equation}"})
        chart.set_x_axis(
            {
                "name": "Gas concentration (%)",
                "min": 0,
                "line": {"color": "#34463B", "width": 1.5},
                "major_tick_mark": "outside",
                "major_gridlines": {"visible": False},
                "num_font": {"color": "#34463B", "size": 9},
                "name_font": {"color": "#24352A", "bold": True, "size": 10},
            }
        )
        chart.set_y_axis(
            {
                "name": "Peak area",
                "min": 0,
                "line": {"color": "#34463B", "width": 1.5},
                "major_tick_mark": "outside",
                "major_gridlines": {
                    "visible": True,
                    "line": {"color": "#DCE8E0", "width": 0.75},
                },
                "num_font": {"color": "#34463B", "size": 9},
                "name_font": {"color": "#24352A", "bold": True, "size": 10},
            }
        )
        chart.set_chartarea({
            "fill": {"color": "#FFFFFF"},
            "border": {"color": "#C9D8CE", "width": 1},
        })
        chart.set_plotarea({
            "fill": {"color": "#FFFFFF"},
            "border": {"color": "#E1EAE4", "width": 1},
        })
        chart.set_legend({
            "position": "bottom",
            "font": {"color": "#34463B", "size": 9},
        })
        chart.set_size({"width": 760, "height": 380})

        worksheet.insert_chart(chart_row, 0, chart)
        chart_row += 21

    worksheet.set_column(0, 10, 14)


def _write_results_plots_sheet(writer, compact_results):
    """Create chart-only result plots that reference the Results sheet."""

    workbook = writer.book
    sheet_name = "Plots"
    data_sheet_name = "Results"
    worksheet = workbook.add_worksheet(sheet_name)
    writer.sheets[sheet_name] = worksheet

    green = "#245F3D"
    title_format = workbook.add_format(
        {"bold": True, "font_size": 16, "font_color": green}
    )
    subtitle_format = workbook.add_format(
        {"font_color": "#66736A"}
    )

    worksheet.write(0, 0, "Result plots", title_format)
    worksheet.write(
        1,
        0,
        "Charts reference the Results table directly; plotting data are not duplicated on this sheet.",
        subtitle_format,
    )

    if len(compact_results) == 0:
        worksheet.write(3, 0, "No result data available.")
        return

    columns = list(compact_results.columns)
    column_index = {name: index for index, name in enumerate(columns)}

    required = {"experiment_id", "sample_id", "time_h"}
    if not required.issubset(set(columns)):
        worksheet.write(3, 0, "Result data are unavailable for plotting.")
        return

    gases = []
    for column_name in columns:
        if column_name.endswith("_gas_percent"):
            gas_id = column_name[:-len("_gas_percent")]
            if gas_id not in gases:
                gases.append(gas_id)

    chart_row = 4

    grouped = compact_results.groupby(
        ["experiment_id", "sample_id"],
        dropna=False,
        sort=False,
    )

    for (experiment_id, sample_id), sample_rows in grouped:
        row_indices = list(sample_rows.index)

        # The Results dataframe is written without its index, so Excel row =
        # dataframe index + 1 (header row is 0).
        first_excel_row = min(row_indices) + 1
        last_excel_row = max(row_indices) + 1

        time_col = column_index["time_h"]

        # Total bottle amount chart.
        total_chart = workbook.add_chart({"type": "line"})

        added_series = 0
        for gas_id in gases:
            metric_col_name = gas_id + "_total_mmol"
            if metric_col_name not in column_index:
                continue

            metric_col = column_index[metric_col_name]

            total_chart.add_series(
                {
                    "name": gas_id,
                    "categories": [
                        data_sheet_name,
                        first_excel_row,
                        time_col,
                        last_excel_row,
                        time_col,
                    ],
                    "values": [
                        data_sheet_name,
                        first_excel_row,
                        metric_col,
                        last_excel_row,
                        metric_col,
                    ],
                    "line": {"width": 2},
                    "marker": {"type": "circle", "size": 4},
                }
            )
            added_series += 1

        if added_series:
            total_chart.set_title(
                {
                    "name": (
                        f"{experiment_id} | {sample_id} - total bottle amount"
                    )
                }
            )
            total_chart.set_x_axis({
                "name": "Time (h)",
                "line": {"color": "#34463B", "width": 1.5},
                "major_tick_mark": "outside",
                "major_gridlines": {"visible": False},
                "num_font": {"color": "#34463B", "size": 9},
                "name_font": {"color": "#24352A", "bold": True, "size": 10},
            })
            total_chart.set_y_axis(
                {
                    "name": "Gas amount (mmol)",
                    "min": 0,
                    "line": {"color": "#34463B", "width": 1.5},
                    "major_tick_mark": "outside",
                    "major_gridlines": {
                        "visible": True,
                        "line": {"color": "#DCE8E0", "width": 0.75},
                    },
                    "num_font": {"color": "#34463B", "size": 9},
                    "name_font": {"color": "#24352A", "bold": True, "size": 10},
                }
            )
            total_chart.set_chartarea({
                "fill": {"color": "#FFFFFF"},
                "border": {"color": "#C9D8CE", "width": 1},
            })
            total_chart.set_plotarea({
                "fill": {"color": "#FFFFFF"},
                "border": {"color": "#E1EAE4", "width": 1},
            })
            total_chart.set_legend({
                "position": "bottom",
                "font": {"color": "#34463B", "size": 9},
            })
            total_chart.set_size({"width": 780, "height": 380})
            worksheet.insert_chart(chart_row, 0, total_chart)
            chart_row += 21

        # Sampling-corrected total amount chart, when the optional
        # sampling columns were supplied for this sample.
        corrected_chart = workbook.add_chart({"type": "line"})
        added_series = 0

        for gas_id in gases:
            corrected_col_name = gas_id + "_sampling_corrected_total_mmol"
            if corrected_col_name not in column_index:
                continue
            if not sample_rows[corrected_col_name].notna().any():
                continue

            corrected_col = column_index[corrected_col_name]
            corrected_chart.add_series(
                {
                    "name": gas_id,
                    "categories": [
                        data_sheet_name,
                        first_excel_row,
                        time_col,
                        last_excel_row,
                        time_col,
                    ],
                    "values": [
                        data_sheet_name,
                        first_excel_row,
                        corrected_col,
                        last_excel_row,
                        corrected_col,
                    ],
                    "line": {"width": 2},
                    "marker": {"type": "circle", "size": 4},
                }
            )
            added_series += 1

        if added_series:
            corrected_chart.set_title(
                {
                    "name": (
                        f"{experiment_id} | {sample_id} - sampling-corrected total amount"
                    )
                }
            )
            corrected_chart.set_x_axis({
                "name": "Time (h)",
                "line": {"color": "#34463B", "width": 1.5},
                "major_tick_mark": "outside",
                "major_gridlines": {"visible": False},
                "num_font": {"color": "#34463B", "size": 9},
                "name_font": {"color": "#24352A", "bold": True, "size": 10},
            })
            corrected_chart.set_y_axis(
                {
                    "name": "Gas amount (mmol)",
                    "min": 0,
                    "line": {"color": "#34463B", "width": 1.5},
                    "major_tick_mark": "outside",
                    "major_gridlines": {
                        "visible": True,
                        "line": {"color": "#DCE8E0", "width": 0.75},
                    },
                    "num_font": {"color": "#34463B", "size": 9},
                    "name_font": {"color": "#24352A", "bold": True, "size": 10},
                }
            )
            corrected_chart.set_chartarea({
                "fill": {"color": "#FFFFFF"},
                "border": {"color": "#C9D8CE", "width": 1},
            })
            corrected_chart.set_plotarea({
                "fill": {"color": "#FFFFFF"},
                "border": {"color": "#E1EAE4", "width": 1},
            })
            corrected_chart.set_legend({
                "position": "bottom",
                "font": {"color": "#34463B", "size": 9},
            })
            corrected_chart.set_size({"width": 780, "height": 380})
            worksheet.insert_chart(chart_row, 0, corrected_chart)
            chart_row += 21

        # Headspace gas concentration chart.
        percent_chart = workbook.add_chart({"type": "line"})
        added_series = 0

        for gas_id in gases:
            percent_col_name = gas_id + "_gas_percent"
            if percent_col_name not in column_index:
                continue

            percent_col = column_index[percent_col_name]

            percent_chart.add_series(
                {
                    "name": gas_id,
                    "categories": [
                        data_sheet_name,
                        first_excel_row,
                        time_col,
                        last_excel_row,
                        time_col,
                    ],
                    "values": [
                        data_sheet_name,
                        first_excel_row,
                        percent_col,
                        last_excel_row,
                        percent_col,
                    ],
                    "line": {"width": 2},
                    "marker": {"type": "circle", "size": 4},
                }
            )
            added_series += 1

        if added_series:
            percent_chart.set_title(
                {
                    "name": (
                        f"{experiment_id} | {sample_id} - headspace gas concentration"
                    )
                }
            )
            percent_chart.set_x_axis({
                "name": "Time (h)",
                "line": {"color": "#34463B", "width": 1.5},
                "major_tick_mark": "outside",
                "major_gridlines": {"visible": False},
                "num_font": {"color": "#34463B", "size": 9},
                "name_font": {"color": "#24352A", "bold": True, "size": 10},
            })
            percent_chart.set_y_axis(
                {
                    "name": "Gas concentration (%)",
                    "min": 0,
                    "line": {"color": "#34463B", "width": 1.5},
                    "major_tick_mark": "outside",
                    "major_gridlines": {
                        "visible": True,
                        "line": {"color": "#DCE8E0", "width": 0.75},
                    },
                    "num_font": {"color": "#34463B", "size": 9},
                    "name_font": {"color": "#24352A", "bold": True, "size": 10},
                }
            )
            percent_chart.set_chartarea({
                "fill": {"color": "#FFFFFF"},
                "border": {"color": "#C9D8CE", "width": 1},
            })
            percent_chart.set_plotarea({
                "fill": {"color": "#FFFFFF"},
                "border": {"color": "#E1EAE4", "width": 1},
            })
            percent_chart.set_legend({
                "position": "bottom",
                "font": {"color": "#34463B", "size": 9},
            })
            percent_chart.set_size({"width": 780, "height": 380})
            worksheet.insert_chart(chart_row, 0, percent_chart)
            chart_row += 22

    worksheet.set_column(0, 12, 14)


def make_output_excel(
    results_table,
    calibration_summary,
    calibration_table=None,
    calibrations=None,
    software_version="v0.1",
    calculation_method_version="v0.1",
    include_plots=True,
):
    """Create the downloadable Excel workbook and return its bytes."""

    output = BytesIO()

    # Normal output is deliberately concise. Extended_data contains the full
    # clear calculation record.
    compact_results = make_compact_results_table(results_table)
    extended_results = make_wide_results_table(results_table)

    if calibration_table is not None and calibrations is not None:
        calibration_data = _make_calibration_data_table(
            calibration_table,
            calibrations,
        )
    else:
        calibration_data = calibration_summary.copy()

    metadata_table = pd.DataFrame(
        {
            "item": [
                "Software version",
                "Calculation version",
                "Normal Results layout",
                "Sampling correction",
                "Sampling-corrected total",
                "CO2 sampling correction",
                "H2S sampling correction",
                "Volume convention",
                "Extended data",
                "Calibration intercept rule",
                "Pressure basis",
                "Water vapour",
                "Compressibility factor",
                "Salinity model",
                "Partial pressure",
                "Partial pressure output",
                "Excel plot sheets",
            ],
            "value": [
                software_version,
                calculation_method_version,
                "one row per bottle/time point; physical total, headspace and molecular dissolved amount per gas; optional sampling-corrected totals remain separate; CO2 also reports estimated DIC; H2S can report estimated dissolved total sulfide",
                "optional liquid_sample_mL and headspace_sample_mL volumes are removed after the measurement on that row and affect only subsequent corrected time points",
                "current total bottle amount plus cumulative gas and molecular dissolved material removed during previous sampling events",
                "when pH is available, an additional inorganic-carbon balance uses gaseous CO2 plus dissolved DIC; DIC is pH-sensitive",
                "when pH is available, an additional sulfide balance uses gaseous H2S plus estimated dissolved total sulfide",
                "enter the actual liquid volume at every measurement; liquid_sample_mL is not automatically subtracted from later rows",
                "full gas-specific calculation output in Extended_data, including sampled and cumulative sampling-loss fields when applicable",
                "linear regression; if fitted intercept is negative, intercept is set to zero and slope is refitted",
                "absolute pressure",
                "neglected in v0.1; correction planned for a later version",
                "ideal gas, Z = 1",
                "Weisenberger-Schumpe (1996), NaCl-equivalent concentration",
                "p_i = y_i × P_abs",
                "Per-gas partial pressure varies by bottle/time point and is reported in Results (bar) and Extended_data (Pa).",
                "Plots and Calibration_curves are optional; source values are in Results and Calibration_data.",
            ],
        }
    )

    gas_property_rows = []
    for gas_id, gas in GAS_PROPERTIES.items():
        gas_property_rows.append(
            {
                "gas_id": gas_id,
                "gas_name": gas["gas_name"],
                "cas_rn": gas["cas_rn"],
                "Hcp_reference_mol_m3_Pa": gas["hcp_ref"],
                "B_K": gas["B_K"],
                "selected_source": gas["selected_sander_entry"],
            }
        )
    gas_properties_table = pd.DataFrame(gas_property_rows)

    with pd.ExcelWriter(output, engine="xlsxwriter") as writer:
        workbook = writer.book

        compact_results.to_excel(writer, sheet_name="Results", index=False)
        extended_results.to_excel(writer, sheet_name="Extended_data", index=False)

        if include_plots:
            _write_results_plots_sheet(writer, compact_results)

        calibration_data.to_excel(writer, sheet_name="Calibration_data", index=False)

        if include_plots:
            _write_calibration_curves_sheet(writer, calibration_data)

        # Metadata and gas properties share one polished Reference sheet.
        info_sheet_name = "Reference"
        info_ws = workbook.add_worksheet(info_sheet_name)
        writer.sheets[info_sheet_name] = info_ws

        title_format = workbook.add_format(
            {"bold": True, "font_size": 16, "font_color": "#245F3D"}
        )
        section_format = workbook.add_format(
            {"bold": True, "font_size": 11, "font_color": "#FFFFFF", "bg_color": "#245F3D"}
        )
        header_format = workbook.add_format(
            {"bold": True, "bg_color": "#EEF7F1", "border": 1, "border_color": "#8FBEA0"}
        )
        mmol_format = workbook.add_format({"num_format": "0.000000"})
        percent_format = workbook.add_format({"num_format": "0.0000"})
        scientific_format = workbook.add_format({"num_format": "0.00E+00"})
        text_format = workbook.add_format({"num_format": "@"})

        # Standard data sheets.
        for sheet_name, dataframe in [
            ("Results", compact_results),
            ("Extended_data", extended_results),
            ("Calibration_data", calibration_data),
        ]:
            worksheet = writer.sheets[sheet_name]
            worksheet.freeze_panes(1, 0)
            worksheet.set_row(0, 22, header_format)

            if len(dataframe.columns) > 0:
                worksheet.autofilter(
                    0,
                    0,
                    len(dataframe),
                    len(dataframe.columns) - 1,
                )

            for column_number, column_name in enumerate(dataframe.columns):
                width = max(12, min(30, len(str(column_name)) + 2))

                if column_name.endswith("_warnings") or column_name.endswith(
                    "_processing_error"
                ):
                    width = 34

                selected_format = None

                if "_mmol" in column_name:
                    selected_format = mmol_format
                elif "_percent" in column_name:
                    selected_format = percent_format

                worksheet.set_column(
                    column_number,
                    column_number,
                    width,
                    selected_format,
                )

        # Combined metadata + properties sheet.
        reference_title_format = workbook.add_format(
            {
                "bold": True,
                "font_size": 17,
                "font_color": "#FFFFFF",
                "bg_color": "#245F3D",
                "valign": "vcenter",
                "align": "left",
            }
        )
        reference_subtitle_format = workbook.add_format(
            {"font_size": 10, "font_color": "#55645A", "italic": True}
        )
        reference_section_format = workbook.add_format(
            {
                "bold": True,
                "font_size": 11,
                "font_color": "#FFFFFF",
                "bg_color": "#245F3D",
                "valign": "vcenter",
            }
        )
        reference_label_format = workbook.add_format(
            {
                "bold": True,
                "font_color": "#24352A",
                "bg_color": "#EEF7F1",
                "border": 1,
                "border_color": "#B8CCBF",
                "valign": "top",
                "text_wrap": True,
            }
        )
        reference_value_format = workbook.add_format(
            {
                "font_color": "#34463B",
                "bg_color": "#FFFFFF",
                "border": 1,
                "border_color": "#D8E2DB",
                "text_wrap": True,
                "valign": "top",
            }
        )
        reference_property_header = workbook.add_format(
            {
                "bold": True,
                "font_color": "#24352A",
                "bg_color": "#DDECE2",
                "border": 1,
                "border_color": "#9EB9A7",
                "align": "center",
                "valign": "vcenter",
            }
        )
        reference_property_even = workbook.add_format(
            {
                "bg_color": "#F8FBF9",
                "border": 1,
                "border_color": "#DFE8E2",
                "valign": "vcenter",
            }
        )
        reference_property_odd = workbook.add_format(
            {
                "bg_color": "#FFFFFF",
                "border": 1,
                "border_color": "#DFE8E2",
                "valign": "vcenter",
            }
        )

        info_ws.hide_gridlines(2)
        info_ws.merge_range(0, 0, 0, 5, "(E)Gasboard output reference", reference_title_format)
        info_ws.set_row(0, 30)
        info_ws.merge_range(
            1, 0, 1, 5,
            "Calculation settings, output conventions and gas-property values used for this workbook.",
            reference_subtitle_format,
        )

        info_ws.merge_range(2, 0, 2, 5, "Calculation settings", reference_section_format)
        info_ws.write(3, 0, "Setting", header_format)
        info_ws.write(3, 1, "Value / convention", header_format)
        info_ws.set_row(3, 22)

        for row_offset in range(len(metadata_table)):
            row_number = 4 + row_offset
            info_ws.set_row(row_number, 31)
            info_ws.write(
                row_number, 0, metadata_table.iloc[row_offset]["item"], reference_label_format
            )
            info_ws.write(
                row_number, 1, metadata_table.iloc[row_offset]["value"], reference_value_format
            )

        property_section_row = 4 + len(metadata_table) + 2
        info_ws.merge_range(
            property_section_row, 0, property_section_row, 5,
            "Gas property library", reference_section_format
        )
        property_header_row = property_section_row + 1
        for column_number, column_name in enumerate(gas_properties_table.columns):
            info_ws.write(
                property_header_row, column_number, column_name, reference_property_header
            )

        for row_offset, row_values in enumerate(
            gas_properties_table.itertuples(index=False, name=None)
        ):
            row_number = property_header_row + 1 + row_offset
            row_format = reference_property_even if row_offset % 2 == 0 else reference_property_odd
            for column_number, value in enumerate(row_values):
                if column_number == 3 and value is not None:
                    info_ws.write_number(row_number, column_number, float(value), scientific_format)
                else:
                    info_ws.write(row_number, column_number, value, row_format)

        info_ws.freeze_panes(4, 0)
        info_ws.set_column(0, 0, 28)
        info_ws.set_column(1, 1, 72)
        info_ws.set_column(2, 2, 16)
        info_ws.set_column(3, 4, 22)
        info_ws.set_column(5, 5, 24)

    return output.getvalue()
