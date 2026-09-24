"""Time-series rate fitting for the (E)Gasboard reference implementation."""


def _finite(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number == number else None


def fit_time_series_rate(rows, metric="total_bottle_mmol", time_start_h=None, time_end_h=None):
    points = []
    start = float("-inf") if time_start_h is None else float(time_start_h)
    end = float("inf") if time_end_h is None else float(time_end_h)

    for row in rows:
        x = _finite(row.get("time_h"))
        y = _finite(row.get(metric))
        if x is None or y is None or x < start or x > end:
            continue
        points.append((x, y, row))

    points.sort(key=lambda item: item[0])
    if len(points) < 2 or len({item[0] for item in points}) < 2:
        raise ValueError("At least two different time points are required for rate fitting.")

    xs = [item[0] for item in points]
    ys = [item[1] for item in points]
    x_mean = sum(xs) / len(xs)
    y_mean = sum(ys) / len(ys)
    covariance = sum((x - x_mean) * (y - y_mean) for x, y in zip(xs, ys))
    x_variance = sum((x - x_mean) ** 2 for x in xs)
    y_variance = sum((y - y_mean) ** 2 for y in ys)

    slope = covariance / x_variance
    intercept = y_mean - slope * x_mean
    residual = sum((y - (slope * x + intercept)) ** 2 for x, y in zip(xs, ys))
    r_squared = 1.0 if y_variance == 0 else max(0.0, min(1.0, 1.0 - residual / y_variance))
    signed_daily = slope * 24.0
    direction = "uptake" if signed_daily < -1e-12 else ("production" if signed_daily > 1e-12 else "no_change")

    return {
        "time_start_h": xs[0],
        "time_end_h": xs[-1],
        "number_of_points": len(points),
        "slope_mmol_h": slope,
        "signed_rate_mmol_d": signed_daily,
        "uptake_rate_mmol_d": -signed_daily if direction == "uptake" else 0.0,
        "production_rate_mmol_d": signed_daily if direction == "production" else 0.0,
        "intercept_mmol": intercept,
        "r_squared": r_squared,
        "direction": direction,
    }
