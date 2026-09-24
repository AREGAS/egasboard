/*
 * (E)Gasboard v0.1 - time-series rate fitting
 *
 * Fits a straight line to a selected bottle/gas time interval. The signed slope
 * is retained so uptake (negative slope) and production (positive slope) are
 * distinguishable. Mass-transfer screening uses the uptake magnitude only.
 */

export const RATE_METRIC_DEFINITIONS = {
  total_bottle_mmol: {
    label: "Total bottle amount",
    export_label: "total_bottle_mmol"
  },
  sampling_corrected_total_mmol: {
    label: "Sampling-corrected total amount",
    export_label: "sampling_corrected_total_mmol"
  },
  estimated_total_inorganic_C_bottle_mmol: {
    label: "Estimated total inorganic C",
    export_label: "estimated_total_inorganic_C_bottle_mmol",
    gas: "CO2"
  },
  estimated_sampling_corrected_total_inorganic_C_mmol: {
    label: "Sampling-corrected estimated total inorganic C",
    export_label: "estimated_sampling_corrected_total_inorganic_C_mmol",
    gas: "CO2"
  },
  estimated_total_sulfide_bottle_mmol: {
    label: "Estimated total sulfide inventory",
    export_label: "estimated_total_sulfide_bottle_mmol",
    gas: "H2S"
  },
  estimated_sampling_corrected_total_sulfide_mmol: {
    label: "Sampling-corrected estimated total sulfide",
    export_label: "estimated_sampling_corrected_total_sulfide_mmol",
    gas: "H2S"
  }
};

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function mean(values) {
  const usable = values.filter(Number.isFinite);
  if (!usable.length) return null;
  return usable.reduce((sum, value) => sum + value, 0) / usable.length;
}

export function availableRateMetrics(rows, gasId) {
  const gas = String(gasId || "").trim().toUpperCase();
  const metrics = [];

  for (const [key, definition] of Object.entries(RATE_METRIC_DEFINITIONS)) {
    if (definition.gas && definition.gas !== gas) continue;
    if (rows.some(row => finiteNumber(row[key]) !== null)) {
      metrics.push({value: key, label: definition.label});
    }
  }

  return metrics;
}

export function fitTimeSeriesRate({
  rows,
  metric = "total_bottle_mmol",
  time_start_h = null,
  time_end_h = null
}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("No time-series rows are available for rate fitting.");
  }

  if (!RATE_METRIC_DEFINITIONS[metric]) {
    throw new Error("Unknown rate basis.");
  }

  const start = time_start_h === null || time_start_h === ""
    ? -Infinity
    : Number(time_start_h);
  const end = time_end_h === null || time_end_h === ""
    ? Infinity
    : Number(time_end_h);

  if (!Number.isFinite(start) && start !== -Infinity) {
    throw new Error("Rate start time must be a number.");
  }
  if (!Number.isFinite(end) && end !== Infinity) {
    throw new Error("Rate end time must be a number.");
  }
  if (start > end) {
    throw new Error("Rate start time must be before the end time.");
  }

  const points = rows
    .map(row => ({
      row,
      x: finiteNumber(row.time_h),
      y: finiteNumber(row[metric])
    }))
    .filter(point =>
      point.x !== null &&
      point.y !== null &&
      point.x >= start &&
      point.x <= end
    )
    .sort((a, b) => a.x - b.x);

  if (points.length < 2) {
    throw new Error("At least two valid time points are required for rate fitting.");
  }

  const uniqueTimes = new Set(points.map(point => point.x));
  if (uniqueTimes.size < 2) {
    throw new Error("Rate fitting requires at least two different time values.");
  }

  const xMean = mean(points.map(point => point.x));
  const yMean = mean(points.map(point => point.y));

  let covariance = 0;
  let xVariance = 0;
  let yVariance = 0;

  for (const point of points) {
    const dx = point.x - xMean;
    const dy = point.y - yMean;
    covariance += dx * dy;
    xVariance += dx * dx;
    yVariance += dy * dy;
  }

  if (!(xVariance > 0)) {
    throw new Error("Rate fitting failed because the selected time values have no spread.");
  }

  const slopeMmolH = covariance / xVariance;
  const interceptMmol = yMean - slopeMmolH * xMean;

  let residualSumSquares = 0;
  for (const point of points) {
    const predicted = slopeMmolH * point.x + interceptMmol;
    residualSumSquares += (point.y - predicted) ** 2;
  }

  const rSquared = yVariance > 0
    ? Math.max(0, Math.min(1, 1 - residualSumSquares / yVariance))
    : 1;

  const signedMmolD = slopeMmolH * 24.0;
  const tolerance = 1e-12;
  const direction = signedMmolD < -tolerance
    ? "uptake"
    : (signedMmolD > tolerance ? "production" : "no_change");

  const meanLiquidMl = mean(points.map(point => finiteNumber(point.row.liquid_volume_mL)));
  const meanLiquidL = meanLiquidMl === null ? null : meanLiquidMl / 1000.0;

  return {
    metric,
    metric_label: RATE_METRIC_DEFINITIONS[metric].label,
    time_start_h: points[0].x,
    time_end_h: points[points.length - 1].x,
    number_of_points: points.length,
    slope_mmol_h: slopeMmolH,
    signed_rate_mmol_d: signedMmolD,
    uptake_rate_mmol_d: direction === "uptake" ? -signedMmolD : 0,
    production_rate_mmol_d: direction === "production" ? signedMmolD : 0,
    signed_rate_umol_d: signedMmolD * 1000.0,
    signed_rate_mmol_L_d: meanLiquidL && meanLiquidL > 0
      ? signedMmolD / meanLiquidL
      : null,
    intercept_mmol: interceptMmol,
    r_squared: rSquared,
    direction,
    mean_liquid_volume_mL: meanLiquidMl,
    mean_temperature_C: mean(points.map(point => finiteNumber(point.row.temperature_C))),
    mean_pressure_bar_abs: mean(points.map(point => finiteNumber(point.row.pressure_bar_abs))),
    mean_gas_percent: mean(points.map(point => finiteNumber(point.row.gas_percent))),
    mean_salinity_g_L_NaCl: mean(points.map(point => finiteNumber(point.row.salinity_g_L_NaCl))) ?? 0,
    points: points.map(point => ({time_h: point.x, amount_mmol: point.y}))
  };
}
