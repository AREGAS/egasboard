from calibration import calculate_gas_percent
from calibration import fit_linear_calibration


def test_multipoint_calibration():
    gas_percent = [0, 0, 5, 5, 10, 10, 20, 20]
    peak_area = [490, 510, 50450, 50550, 100300, 100700, 200400, 200600]

    fit = fit_linear_calibration(gas_percent, peak_area)
    sample_percent = calculate_gas_percent(150500, fit)

    assert abs(fit["slope"] - 10000) < 1
    assert abs(fit["intercept"] - 500) < 10
    assert fit["r_squared"] > 0.999
    assert abs(sample_percent - 15.0) < 0.01



def test_negative_multipoint_intercept_is_constrained_to_zero():
    calibration = fit_linear_calibration(
        [0.0, 0.93541, 2.32941, 4.51637, 8.69414],
        [0.0, 100.6, 264.0, 530.0, 1054.1],
    )

    assert calibration["intercept"] == 0.0
    assert calibration["slope"] > 0
    assert calibration["mode"] == "linear regression, intercept constrained to zero"
