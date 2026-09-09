/*
 * (E)Gasboard v0.1 - browser Excel input/output
 *
 * ExcelJS is loaded in the browser before this ES module. It is used only for
 * file transport and workbook formatting. Scientific calculations stay
 * in the calculation modules under /js.
 *
 * Plot sheets contain HIGH-RESOLUTION PNG figures, not duplicated data tables.
 * The numerical source data remain in Results and Calibration_data.
 */

import {GAS_PROPERTIES} from "./gas-properties.js";
import {valueIsMissing} from "./batch-processing.js";

const GREEN = "FF245F3D";
const PALE_GREEN = "FFEEF7F1";
const MID_GREEN = "FFDDECE2";
const BORDER_GREEN = "FFB8CCBF";
const TEXT = "FF24352A";
const MUTED = "FF66736A";
const WHITE = "FFFFFFFF";

export function excelJsAvailable() {
  return typeof globalThis.ExcelJS !== "undefined";
}

function requireExcelJs() {
  if (!excelJsAvailable()) {
    throw new Error(
      "The Excel library could not be loaded. Check your internet connection and reload the page."
    );
  }
  return globalThis.ExcelJS;
}

function normalizeCellValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "object" && value.result !== undefined) return value.result;
  if (typeof value === "object" && value.text !== undefined) return value.text;
  return value;
}

export async function readFirstWorksheet(file) {
  const ExcelJS = requireExcelJs();
  const buffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("The uploaded workbook contains no worksheets.");

  const headerRow = worksheet.getRow(1);
  const headers = [];
  for (let column = 1; column <= headerRow.cellCount; column += 1) {
    const raw = normalizeCellValue(headerRow.getCell(column).value);
    headers.push(raw === null ? "" : String(raw).trim());
  }

  const rows = [];
  for (let rowNumber = 2; rowNumber <= worksheet.actualRowCount; rowNumber += 1) {
    const excelRow = worksheet.getRow(rowNumber);
    const output = {};
    let hasAnyValue = false;

    headers.forEach((header, index) => {
      if (!header) return;
      const value = normalizeCellValue(excelRow.getCell(index + 1).value);
      output[header] = value;
      if (!valueIsMissing(value)) hasAnyValue = true;
    });

    if (hasAnyValue) rows.push(output);
  }

  return rows;
}

function tableColumns(rows) {
  const columns = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!columns.includes(key)) columns.push(key);
    }
  }
  return columns;
}

function applyHeaderStyle(row) {
  row.height = 24;
  row.eachCell(cell => {
    cell.font = {bold: true, color: {argb: TEXT}};
    cell.fill = {type: "pattern", pattern: "solid", fgColor: {argb: MID_GREEN}};
    cell.border = {
      top: {style: "thin", color: {argb: BORDER_GREEN}},
      bottom: {style: "thin", color: {argb: BORDER_GREEN}},
      left: {style: "thin", color: {argb: BORDER_GREEN}},
      right: {style: "thin", color: {argb: BORDER_GREEN}}
    };
    cell.alignment = {vertical: "middle", horizontal: "center", wrapText: true};
  });
}

function writeRows(worksheet, rows) {
  if (!rows.length) {
    worksheet.getCell("A1").value = "No data available";
    worksheet.getCell("A1").font = {italic: true, color: {argb: MUTED}};
    return;
  }

  const columns = tableColumns(rows);
  worksheet.addRow(columns);
  applyHeaderStyle(worksheet.getRow(1));

  for (const row of rows) {
    worksheet.addRow(columns.map(column => row[column] ?? null));
  }

  worksheet.views = [{state: "frozen", ySplit: 1}];
  worksheet.properties.defaultRowHeight = 18;
  worksheet.showGridLines = false;

  columns.forEach((columnName, index) => {
    const column = worksheet.getColumn(index + 1);
    let width = Math.max(11, Math.min(28, String(columnName).length + 3));
    if (["warnings", "processing_error", "henry_source"].includes(columnName)) width = 34;
    if (["experiment_id", "sample_id"].includes(columnName)) width = Math.max(width, 16);
    column.width = width;

    if (columnName.includes("Hcp") || columnName.includes("henry_")) {
      column.numFmt = "0.000E+00";
    } else if (columnName.includes("mmol") || columnName.includes("percent") || columnName.includes("pressure")) {
      column.numFmt = "0.000000";
    }
  });

  worksheet.autoFilter = {
    from: {row: 1, column: 1},
    to: {row: 1, column: columns.length}
  };
}

function addTitle(worksheet, title, subtitle) {
  worksheet.mergeCells("A1:H1");
  const titleCell = worksheet.getCell("A1");
  titleCell.value = title;
  titleCell.font = {bold: true, size: 17, color: {argb: WHITE}};
  titleCell.fill = {type: "pattern", pattern: "solid", fgColor: {argb: GREEN}};
  titleCell.alignment = {vertical: "middle", horizontal: "left"};
  worksheet.getRow(1).height = 30;

  worksheet.mergeCells("A2:H2");
  const subtitleCell = worksheet.getCell("A2");
  subtitleCell.value = subtitle;
  subtitleCell.font = {italic: true, size: 10, color: {argb: MUTED}};
  subtitleCell.alignment = {vertical: "middle", wrapText: true};
  worksheet.getRow(2).height = 26;
}

function calibrationDataRows(calibrationRows, calibrations) {
  const output = [];
  const gasIds = [...new Set(
    calibrationRows.map(row => String(row.gas_id).trim().toUpperCase())
  )];

  for (const gasId of gasIds) {
    const model = calibrations[gasId];
    const rows = calibrationRows.filter(
      row => String(row.gas_id).trim().toUpperCase() === gasId
    );

    for (const row of rows) {
      const gasPercent = Number(row.gas_percent);
      output.push({
        gas_id: gasId,
        calibration_id: row.calibration_id ?? "",
        gas_percent: gasPercent,
        peak_area: Number(row.peak_area),
        fitted_peak_area: model.slope * gasPercent + model.intercept,
        model: model.mode,
        slope_area_per_percent: model.slope,
        intercept_area: model.intercept,
        r_squared: model.r_squared,
        n_points: model.number_of_points,
        calibration_min_percent: model.minimum_percent,
        calibration_max_percent: model.maximum_percent
      });
    }
  }

  return output;
}

function drawAxes(ctx, box, xMin, xMax, yMin, yMax, xLabel, yLabel) {
  const {left, top, width, height} = box;
  ctx.save();
  ctx.font = "22px Arial";
  ctx.fillStyle = "#34463B";
  ctx.strokeStyle = "#DCE8E0";
  ctx.lineWidth = 2;

  for (let i = 0; i <= 5; i += 1) {
    const fraction = i / 5;
    const x = left + fraction * width;
    const y = top + height - fraction * height;

    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(left + width, y);
    ctx.stroke();

    const xValue = xMin + fraction * (xMax - xMin);
    const yValue = yMin + fraction * (yMax - yMin);

    ctx.textAlign = "center";
    ctx.fillText(formatTick(xValue), x, top + height + 42);
    ctx.textAlign = "right";
    ctx.fillText(formatTick(yValue), left - 18, y + 8);
  }

  ctx.strokeStyle = "#34463B";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(left, top + height);
  ctx.lineTo(left + width, top + height);
  ctx.stroke();

  ctx.fillStyle = "#24352A";
  ctx.font = "bold 25px Arial";
  ctx.textAlign = "center";
  ctx.fillText(xLabel, left + width / 2, top + height + 92);

  ctx.save();
  ctx.translate(38, top + height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();
  ctx.restore();
}

function formatTick(value) {
  const abs = Math.abs(value);
  if ((abs > 0 && abs < 0.001) || abs >= 10000) return value.toExponential(2);
  if (abs >= 100) return value.toFixed(0);
  if (abs >= 1) return value.toFixed(2);
  return value.toFixed(3);
}

function createCanvas(width = 1800, height = 900) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, width, height);
  return {canvas, ctx};
}

const PLOT_COLORS = [
  "#245F3D", "#7B1E2B", "#4169A1", "#8A6D1F", "#76518E",
  "#2F7F7F", "#9A4F2A", "#5F6F3A", "#4C6F91"
];

function pngForLineSeries(series, title, yLabel) {
  const {canvas, ctx} = createCanvas();
  const box = {left: 155, top: 110, width: 1510, height: 610};

  const allX = series.flatMap(item => item.xValues).filter(Number.isFinite);
  const allY = series.flatMap(item => item.yValues).filter(Number.isFinite);

  let xMin = Math.min(0, ...allX);
  let xMax = Math.max(...allX);
  if (xMax === xMin) xMax = xMin + 1;

  let yMinRaw = Math.min(...allY);
  let yMaxRaw = Math.max(...allY);
  let yMin = yMinRaw >= 0 ? 0 : yMinRaw;
  let yMax = yMaxRaw === yMin ? yMin + 1 : yMaxRaw * 1.08;

  ctx.fillStyle = "#245F3D";
  ctx.font = "bold 35px Arial";
  ctx.textAlign = "left";
  ctx.fillText(title, 155, 60);

  drawAxes(ctx, box, xMin, xMax, yMin, yMax, "Time (h)", yLabel);

  const xScale = x => box.left + ((x - xMin) / (xMax - xMin)) * box.width;
  const yScale = y => box.top + box.height - ((y - yMin) / (yMax - yMin)) * box.height;

  series.forEach((item, seriesIndex) => {
    const color = PLOT_COLORS[seriesIndex % PLOT_COLORS.length];
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    ctx.beginPath();
    item.xValues.forEach((x, index) => {
      const px = xScale(x);
      const py = yScale(item.yValues[index]);
      if (index === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();

    item.xValues.forEach((x, index) => {
      ctx.beginPath();
      ctx.arc(xScale(x), yScale(item.yValues[index]), 8, 0, Math.PI * 2);
      ctx.fill();
    });
  });

  // Compact legend under the title.
  ctx.font = "23px Arial";
  let legendX = 155;
  const legendY = 95;
  series.forEach((item, seriesIndex) => {
    const color = PLOT_COLORS[seriesIndex % PLOT_COLORS.length];
    ctx.fillStyle = color;
    ctx.fillRect(legendX, legendY - 13, 28, 6);
    ctx.fillStyle = "#24352A";
    ctx.textAlign = "left";
    ctx.fillText(item.label, legendX + 38, legendY);
    legendX += 38 + ctx.measureText(item.label).width + 38;
  });

  return canvas.toDataURL("image/png");
}

function pngForCalibration(gasId, rows, model) {
  const {canvas, ctx} = createCanvas();
  const box = {left: 155, top: 120, width: 1510, height: 600};

  const xValues = rows.map(row => Number(row.gas_percent));
  const measured = rows.map(row => Number(row.peak_area));
  const fitted = rows.map(row => Number(row.fitted_peak_area));

  const xMin = 0;
  const xMaxRaw = Math.max(...xValues);
  const xMax = xMaxRaw <= 0 ? 1 : xMaxRaw * 1.05;
  const yMaxRaw = Math.max(...measured, ...fitted, 0);
  const yMin = 0;
  const yMax = yMaxRaw <= 0 ? 1 : yMaxRaw * 1.08;

  let equation = `A = ${Number(model.slope).toPrecision(5)}x`;
  if (Math.abs(Number(model.intercept)) > 1e-12) {
    equation += model.intercept >= 0
      ? ` + ${Number(model.intercept).toPrecision(4)}`
      : ` - ${Math.abs(Number(model.intercept)).toPrecision(4)}`;
  }
  if (model.r_squared !== null && model.r_squared !== undefined) {
    equation += `; R² = ${Number(model.r_squared).toFixed(4)}`;
  }

  ctx.fillStyle = "#245F3D";
  ctx.font = "bold 35px Arial";
  ctx.textAlign = "left";
  ctx.fillText(`${gasId} calibration curve`, 155, 60);

  ctx.fillStyle = "#66736A";
  ctx.font = "25px Arial";
  ctx.fillText(equation, 155, 96);

  drawAxes(ctx, box, xMin, xMax, yMin, yMax, "Gas concentration (%)", "Peak area");

  const xScale = x => box.left + ((x - xMin) / (xMax - xMin)) * box.width;
  const yScale = y => box.top + box.height - ((y - yMin) / (yMax - yMin)) * box.height;

  const sorted = rows.slice().sort((a, b) => Number(a.gas_percent) - Number(b.gas_percent));
  ctx.strokeStyle = "#245F3D";
  ctx.lineWidth = 5;
  ctx.beginPath();
  sorted.forEach((row, index) => {
    const x = xScale(Number(row.gas_percent));
    const y = yScale(Number(row.fitted_peak_area));
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = "#24352A";
  rows.forEach(row => {
    ctx.beginPath();
    ctx.arc(xScale(Number(row.gas_percent)), yScale(Number(row.peak_area)), 9, 0, Math.PI * 2);
    ctx.fill();
  });

  return canvas.toDataURL("image/png");
}

function addPng(ExcelJS, workbook, worksheet, dataUrl, range) {
  const imageId = workbook.addImage({base64: dataUrl, extension: "png"});
  worksheet.addImage(imageId, range);
}

function writePlotSheet(ExcelJS, workbook, results) {
  const worksheet = workbook.addWorksheet("Plots");
  addTitle(
    worksheet,
    "Result plots",
    "All-gas sample plots generated in the browser. Source numbers are stored once in Results."
  );
  worksheet.showGridLines = false;
  worksheet.getColumn(1).width = 14;

  const valid = results.filter(row => !row.processing_error);
  const sampleKeys = [];
  for (const row of valid) {
    const key = `${row.experiment_id}\u0001${row.sample_id}`;
    if (!sampleKeys.includes(key)) sampleKeys.push(key);
  }

  let startRow = 4;

  for (const key of sampleKeys) {
    const [experimentId, sampleId] = key.split("\u0001");
    const sampleRows = valid.filter(row =>
      String(row.experiment_id) === experimentId && String(row.sample_id) === sampleId
    );
    const gases = [...new Set(sampleRows.map(row => String(row.gas_id)))];

    const totalSeries = gases.map(gas => {
      const rows = sampleRows
        .filter(row => String(row.gas_id) === gas)
        .sort((a, b) => Number(a.time_h) - Number(b.time_h));
      return {
        label: gas,
        xValues: rows.map(row => Number(row.time_h)),
        yValues: rows.map(row => Number(row.total_bottle_mmol))
      };
    });

    const percentSeries = gases.map(gas => {
      const rows = sampleRows
        .filter(row => String(row.gas_id) === gas)
        .sort((a, b) => Number(a.time_h) - Number(b.time_h));
      return {
        label: gas,
        xValues: rows.map(row => Number(row.time_h)),
        yValues: rows.map(row => Number(row.gas_percent))
      };
    });

    const totalPng = pngForLineSeries(
      totalSeries,
      `${experimentId} | ${sampleId} - total bottle amount`,
      "Gas amount (mmol)"
    );
    const percentPng = pngForLineSeries(
      percentSeries,
      `${experimentId} | ${sampleId} - headspace gas concentration`,
      "Gas concentration (%)"
    );

    addPng(ExcelJS, workbook, worksheet, totalPng, {
      tl: {col: 0, row: startRow - 1},
      ext: {width: 900, height: 450}
    });
    startRow += 24;

    addPng(ExcelJS, workbook, worksheet, percentPng, {
      tl: {col: 0, row: startRow - 1},
      ext: {width: 900, height: 450}
    });
    startRow += 26;
  }

  return worksheet;
}

function writeCalibrationPlotSheet(ExcelJS, workbook, calibrationData, calibrations) {
  const worksheet = workbook.addWorksheet("Calibration_curves");
  addTitle(
    worksheet,
    "Calibration curves",
    "Observed standards and fitted calibration lines. Source values are stored once in Calibration_data."
  );
  worksheet.showGridLines = false;

  const gases = [...new Set(calibrationData.map(row => String(row.gas_id)))];
  let startRow = 4;

  for (const gasId of gases) {
    const rows = calibrationData.filter(row => String(row.gas_id) === gasId);
    const png = pngForCalibration(gasId, rows, calibrations[gasId]);
    addPng(ExcelJS, workbook, worksheet, png, {
      tl: {col: 0, row: startRow - 1},
      ext: {width: 900, height: 450}
    });
    startRow += 25;
  }

  return worksheet;
}

function writeReferenceSheet(workbook, includePlots) {
  const worksheet = workbook.addWorksheet("Reference");
  worksheet.showGridLines = false;
  addTitle(
    worksheet,
    "(E)Gasboard output reference",
    "Calculation settings, output conventions and the gas-property library used for this workbook."
  );

  const settings = [
    ["Software version", "v0.1"],
    ["Calculation version", "v0.1"],
    ["Results", "One row per bottle/time point. Total bottle amount is headspace + molecular dissolved gas. CO2 and H2S reactive pools are separate."],
    ["Extended data", "Detailed gas-specific calculation output."],
    ["Calibration", "Linear regression. If the fitted intercept is negative, it is set to zero and the slope is refitted."],
    ["Pressure basis", "Absolute pressure"],
    ["Water vapour", "Neglected in v0.1. A correction is planned for a later version."],
    ["Gas law", "Ideal gas law with Z = 1."],
    ["Salting out", "Weisenberger-Schumpe (1996), using NaCl-equivalent concentration."],
    ["Partial pressure", "p_i = y_i × P_abs"],
    ["Partial pressure output", "Results: bar. Extended_data: Pa."],
    ["Excel plot sheets", includePlots
      ? "Plots and Calibration_curves contain PNG figures. Source values stay in Results and Calibration_data."
      : "Plot sheets were not requested for this export."]
  ];

  worksheet.mergeCells("A3:F3");
  const heading = worksheet.getCell("A3");
  heading.value = "Calculation settings";
  heading.font = {bold: true, size: 11, color: {argb: WHITE}};
  heading.fill = {type: "pattern", pattern: "solid", fgColor: {argb: GREEN}};

  worksheet.getCell("A4").value = "Setting";
  worksheet.getCell("B4").value = "Value / convention";
  applyHeaderStyle(worksheet.getRow(4));

  settings.forEach((entry, index) => {
    const row = 5 + index;
    worksheet.getCell(row, 1).value = entry[0];
    worksheet.getCell(row, 2).value = entry[1];
    worksheet.getCell(row, 1).font = {bold: true, color: {argb: TEXT}};
    worksheet.getCell(row, 1).fill = {type: "pattern", pattern: "solid", fgColor: {argb: PALE_GREEN}};
    worksheet.getCell(row, 2).alignment = {wrapText: true, vertical: "top"};
    worksheet.getCell(row, 1).alignment = {wrapText: true, vertical: "top"};
    for (let col = 1; col <= 2; col += 1) {
      worksheet.getCell(row, col).border = {
        top: {style: "thin", color: {argb: "FFD8E2DB"}},
        bottom: {style: "thin", color: {argb: "FFD8E2DB"}},
        left: {style: "thin", color: {argb: "FFD8E2DB"}},
        right: {style: "thin", color: {argb: "FFD8E2DB"}}
      };
    }
    worksheet.getRow(row).height = 32;
  });

  const propertySectionRow = 5 + settings.length + 2;
  worksheet.mergeCells(propertySectionRow, 1, propertySectionRow, 6);
  const propertyHeading = worksheet.getCell(propertySectionRow, 1);
  propertyHeading.value = "Gas property library";
  propertyHeading.font = {bold: true, size: 11, color: {argb: WHITE}};
  propertyHeading.fill = {type: "pattern", pattern: "solid", fgColor: {argb: GREEN}};

  const propertyHeaderRow = propertySectionRow + 1;
  const headers = ["gas_id", "gas_name", "cas_rn", "Hcp_reference_mol_m3_Pa", "B_K", "selected_source"];
  headers.forEach((header, index) => worksheet.getCell(propertyHeaderRow, index + 1).value = header);
  applyHeaderStyle(worksheet.getRow(propertyHeaderRow));

  Object.values(GAS_PROPERTIES).forEach((gas, index) => {
    const rowNumber = propertyHeaderRow + 1 + index;
    const values = [gas.gas_id, gas.gas_name, gas.cas_rn, gas.hcp_ref, gas.B_K, gas.selected_sander_entry];
    values.forEach((value, columnIndex) => {
      const cell = worksheet.getCell(rowNumber, columnIndex + 1);
      cell.value = value;
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: {argb: index % 2 === 0 ? "FFF8FBF9" : WHITE}
      };
      cell.border = {
        top: {style: "thin", color: {argb: "FFDFE8E2"}},
        bottom: {style: "thin", color: {argb: "FFDFE8E2"}},
        left: {style: "thin", color: {argb: "FFDFE8E2"}},
        right: {style: "thin", color: {argb: "FFDFE8E2"}}
      };
    });
    worksheet.getCell(rowNumber, 4).numFmt = "0.00E+00";
  });

  worksheet.getColumn(1).width = 28;
  worksheet.getColumn(2).width = 72;
  worksheet.getColumn(3).width = 18;
  worksheet.getColumn(4).width = 24;
  worksheet.getColumn(5).width = 16;
  worksheet.getColumn(6).width = 24;
  worksheet.views = [{state: "frozen", ySplit: 4}];
}

export async function makeOutputWorkbook({
  results,
  compactResults,
  wideResults,
  calibrationRows,
  calibrations,
  includePlots = true
}) {
  const ExcelJS = requireExcelJs();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "(E)Gasboard";
  workbook.title = "(E)Gasboard results";
  workbook.subject = "Gas calculations for closed incubations";
  workbook.created = new Date();

  const resultsSheet = workbook.addWorksheet("Results");
  writeRows(resultsSheet, compactResults);

  const extendedSheet = workbook.addWorksheet("Extended_data");
  writeRows(extendedSheet, wideResults);

  if (includePlots) {
    writePlotSheet(ExcelJS, workbook, results);
  }

  const calibrationData = calibrationDataRows(calibrationRows, calibrations);
  const calibrationSheet = workbook.addWorksheet("Calibration_data");
  writeRows(calibrationSheet, calibrationData);

  if (includePlots) {
    writeCalibrationPlotSheet(ExcelJS, workbook, calibrationData, calibrations);
  }

  writeReferenceSheet(workbook, includePlots);

  return workbook;
}

export async function workbookToBlob(workbook) {
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob(
    [buffer],
    {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}
  );
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
