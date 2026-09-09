"""
Calibration functions for (E)Gasboard.

The relationship is:

    peak area = slope * gas_percent + intercept

Replicate calibration points remain separate observations.
The regression is written out explicitly so the mathematics is visible.
"""


def fit_linear_calibration(gas_percent_values, peak_area_values):
    """Fit a simple linear calibration and return a dictionary of results."""

    # ------------------------------------------------------------------
    # STEP 1 - Basic checks
    # ------------------------------------------------------------------
    if len(gas_percent_values) != len(peak_area_values):
        raise ValueError("Gas % and peak-area lists must have equal length.")

    if len(gas_percent_values) == 0:
        raise ValueError("At least one calibration point is required.")

    x_values = [float(value) for value in gas_percent_values]
    y_values = [float(value) for value in peak_area_values]

    unique_concentrations = sorted(set(x_values))

    # ------------------------------------------------------------------
    # STEP 2 - Normal multipoint regression
    # ------------------------------------------------------------------
    if len(unique_concentrations) >= 2:
        number_of_points = len(x_values)

        mean_x = sum(x_values) / number_of_points
        mean_y = sum(y_values) / number_of_points

        numerator = 0.0
        denominator = 0.0

        for x, y in zip(x_values, y_values):
            numerator = numerator + ((x - mean_x) * (y - mean_y))
            denominator = denominator + ((x - mean_x) ** 2)

        if denominator == 0:
            raise ValueError("Calibration concentrations have no variation.")

        slope = numerator / denominator
        intercept = mean_y - (slope * mean_x)

        # Peak area cannot physically be negative. If the unconstrained
        # multipoint regression would predict a negative area at 0% gas,
        # constrain the intercept to zero and re-estimate the slope.
        #
        # For y = m*x through the origin, least-squares slope is:
        # m = sum(x*y) / sum(x^2)
        if intercept < 0:
            sum_x_squared = 0.0
            sum_x_y = 0.0

            for x, y in zip(x_values, y_values):
                sum_x_squared = sum_x_squared + (x ** 2)
                sum_x_y = sum_x_y + (x * y)

            if sum_x_squared == 0:
                raise ValueError("Calibration concentrations have no non-zero values.")

            slope = sum_x_y / sum_x_squared
            intercept = 0.0
            calibration_mode = "linear regression, intercept constrained to zero"
        else:
            calibration_mode = "linear regression with intercept"

        # --------------------------------------------------------------
        # STEP 3 - Calculate R squared for the final fitted model
        # --------------------------------------------------------------
        residual_sum_squares = 0.0
        total_sum_squares = 0.0

        for x, measured_y in zip(x_values, y_values):
            predicted_y = (slope * x) + intercept
            residual_sum_squares = residual_sum_squares + (
                (measured_y - predicted_y) ** 2
            )
            total_sum_squares = total_sum_squares + (
                (measured_y - mean_y) ** 2
            )

        if total_sum_squares == 0:
            r_squared = None
        else:
            r_squared = 1.0 - (residual_sum_squares / total_sum_squares)

    # ------------------------------------------------------------------
    # STEP 4 - Single-point calibration
    # ------------------------------------------------------------------
    else:
        concentration = unique_concentrations[0]

        if concentration <= 0:
            raise ValueError(
                "A single-point calibration needs a non-zero standard."
            )

        # For one concentration level there is no independent intercept.
        # Therefore the calibration is forced through zero.
        mean_peak_area = sum(y_values) / len(y_values)
        slope = mean_peak_area / concentration
        intercept = 0.0
        r_squared = None
        calibration_mode = "single point, forced through zero"

    if slope <= 0:
        raise ValueError("Calibration slope must be positive.")

    return {
        "slope": slope,
        "intercept": intercept,
        "r_squared": r_squared,
        "number_of_points": len(x_values),
        "minimum_percent": min(x_values),
        "maximum_percent": max(x_values),
        "mode": calibration_mode,
    }


def calculate_gas_percent(peak_area, calibration):
    """Convert one sample peak area to gas % using the fitted calibration."""

    slope = calibration["slope"]
    intercept = calibration["intercept"]

    gas_percent = (float(peak_area) - intercept) / slope

    return gas_percent


def calibration_is_extrapolated(gas_percent, calibration):
    """Check whether a calculated gas % lies outside the standards."""

    minimum = calibration["minimum_percent"]
    maximum = calibration["maximum_percent"]

    if gas_percent < minimum or gas_percent > maximum:
        return True

    return False
