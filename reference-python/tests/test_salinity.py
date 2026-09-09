from salinity import apply_salinity_to_henry
from salinity import calculate_nacl_salinity_correction


def test_co2_nacl_salting_out_at_25c():
    result = calculate_nacl_salinity_correction(
        gas_id="CO2",
        temperature_k=298.15,
        salinity_g_l_nacl=35.0,
    )

    # At 298.15 K for CO2: K = 0.1143 + 0.0318 + 2*(-0.0172) = 0.1117
    assert abs(result["sechenov_K"] - 0.1117) < 0.000001
    assert result["salting_out_factor"] > 1.0

    corrected = apply_salinity_to_henry(3.4e-4, result["salting_out_factor"])
    assert corrected < 3.4e-4


def test_co_salinity_is_flagged_as_unavailable():
    result = calculate_nacl_salinity_correction(
        gas_id="CO",
        temperature_k=303.15,
        salinity_g_l_nacl=10.0,
    )

    assert result["correction_available"] is False
    assert result["salting_out_factor"] == 1.0
    assert "no Weisenberger-Schumpe" in result["warning"]
