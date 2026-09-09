from speciation import calculate_co2_speciation
from speciation import calculate_h2s_speciation


def test_co2_fractions_add_to_one():
    result = calculate_co2_speciation(7.25, 303.15)

    total_fraction = (
        result["fraction_CO2_star"]
        + result["fraction_HCO3"]
        + result["fraction_CO3"]
    )

    assert abs(total_fraction - 1.0) < 0.000001


def test_h2s_fractions_add_to_one():
    result = calculate_h2s_speciation(7.25, 303.15)

    total_fraction = (
        result["fraction_H2S"]
        + result["fraction_HS"]
        + result["fraction_S2"]
    )

    assert abs(total_fraction - 1.0) < 0.000001
    assert result["pK2"] == 14.00
    assert result["fraction_S2"] >= 0.0
