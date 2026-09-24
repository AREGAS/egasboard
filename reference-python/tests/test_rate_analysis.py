from rate_analysis import fit_time_series_rate


def test_linear_uptake_rate():
    rows = [
        {"time_h": 0, "total_bottle_mmol": 1.0},
        {"time_h": 2, "total_bottle_mmol": 0.8},
        {"time_h": 4, "total_bottle_mmol": 0.6},
    ]
    fit = fit_time_series_rate(rows)
    assert abs(fit["slope_mmol_h"] + 0.1) < 1e-12
    assert abs(fit["uptake_rate_mmol_d"] - 2.4) < 1e-12
    assert fit["direction"] == "uptake"
    assert abs(fit["r_squared"] - 1.0) < 1e-12
