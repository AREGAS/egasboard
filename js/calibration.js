/*
 * (E)Gasboard v0.1 - calibration mathematics
 *
 * Relationship:
 *
 *     peak area = slope * gas_percent + intercept
 *
 * Multipoint calibration starts as ordinary least-squares with an intercept.
 * If that fitted intercept is negative, the final physical model is constrained
 * to intercept = 0 and the slope is refitted through the origin:
 *
 *     slope = sum(x*y) / sum(x^2)
 *
 * R² is always recalculated for the FINAL fitted model.
 */

export function fitLinearCalibration(gasPercentValues, peakAreaValues) {
  if (gasPercentValues.length !== peakAreaValues.length) {
    throw new Error("Gas % and peak-area lists must have equal length.");
  }

  if (gasPercentValues.length === 0) {
    throw new Error("At least one calibration point is required.");
  }

  const xValues = gasPercentValues.map(Number);
  const yValues = peakAreaValues.map(Number);
  const uniqueConcentrations = [...new Set(xValues)].sort((a, b) => a - b);

  let slope;
  let intercept;
  let rSquared;
  let mode;

  if (uniqueConcentrations.length >= 2) {
    const n = xValues.length;
    const meanX = xValues.reduce((sum, value) => sum + value, 0) / n;
    const meanY = yValues.reduce((sum, value) => sum + value, 0) / n;

    let numerator = 0.0;
    let denominator = 0.0;

    for (let i = 0; i < n; i += 1) {
      numerator += (xValues[i] - meanX) * (yValues[i] - meanY);
      denominator += (xValues[i] - meanX) ** 2;
    }

    if (denominator === 0) {
      throw new Error("Calibration concentrations have no variation.");
    }

    slope = numerator / denominator;
    intercept = meanY - (slope * meanX);

    if (intercept < 0) {
      let sumXSquared = 0.0;
      let sumXY = 0.0;

      for (let i = 0; i < n; i += 1) {
        sumXSquared += xValues[i] ** 2;
        sumXY += xValues[i] * yValues[i];
      }

      if (sumXSquared === 0) {
        throw new Error("Calibration concentrations have no non-zero values.");
      }

      slope = sumXY / sumXSquared;
      intercept = 0.0;
      mode = "linear regression, intercept constrained to zero";
    } else {
      mode = "linear regression with intercept";
    }

    let residualSumSquares = 0.0;
    let totalSumSquares = 0.0;

    for (let i = 0; i < n; i += 1) {
      const predicted = (slope * xValues[i]) + intercept;
      residualSumSquares += (yValues[i] - predicted) ** 2;
      totalSumSquares += (yValues[i] - meanY) ** 2;
    }

    rSquared = totalSumSquares === 0
      ? null
      : 1.0 - (residualSumSquares / totalSumSquares);
  } else {
    const concentration = uniqueConcentrations[0];

    if (!(concentration > 0)) {
      throw new Error("A single-point calibration needs a non-zero standard.");
    }

    const meanPeakArea =
      yValues.reduce((sum, value) => sum + value, 0) / yValues.length;

    slope = meanPeakArea / concentration;
    intercept = 0.0;
    rSquared = null;
    mode = "single point, forced through zero";
  }

  if (!(slope > 0)) {
    throw new Error("Calibration slope must be positive.");
  }

  return {
    slope,
    intercept,
    r_squared: rSquared,
    number_of_points: xValues.length,
    minimum_percent: Math.min(...xValues),
    maximum_percent: Math.max(...xValues),
    mode
  };
}

export function calculateGasPercent(peakArea, calibration) {
  return (Number(peakArea) - calibration.intercept) / calibration.slope;
}

export function calibrationIsExtrapolated(gasPercent, calibration) {
  return Number(gasPercent) < calibration.minimum_percent ||
         Number(gasPercent) > calibration.maximum_percent;
}
