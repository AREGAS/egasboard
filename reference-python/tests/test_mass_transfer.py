from mass_transfer import calculate_mass_transfer_assessment
from mass_transfer import get_kla_screening_estimate


def test_kla_screening_table_small_bottle_200_rpm():
    result = get_kla_screening_estimate("small_bottle", 200)

    assert result["central_kla_h"] == 15.0
    assert result["low_kla_h"] == 7.5
    assert result["high_kla_h"] == 22.5
    assert result["high_speed_extrapolation"] is False


def test_mass_transfer_capacity_matches_equation():
    result = calculate_mass_transfer_assessment(
        gas_id="CO",
        observed_rate_value=0.20,
        observed_rate_unit="mmol_d",
        liquid_volume_ml=40.0,
        temperature_c=30.0,
        pressure_bar_abs=1.01325,
        headspace_gas_percent=10.0,
        salinity_g_l_nacl=0.0,
        kla_source="custom",
        custom_kla_h=10.0,
    )

    expected_capacity = (
        10.0
        * 0.040
        * result["equilibrium_dissolved_mmol_L"]
        * 24.0
    )

    assert abs(result["transfer_capacity_central_mmol_d"] - expected_capacity) < 1e-12
    assert abs(
        result["transfer_demand_ratio_central"]
        - 0.20 / expected_capacity
    ) < 1e-12


def test_volumetric_rate_unit_converts_to_whole_bottle_rate():
    result = calculate_mass_transfer_assessment(
        gas_id="O2",
        observed_rate_value=5.0,
        observed_rate_unit="mmol_L_d",
        liquid_volume_ml=100.0,
        temperature_c=25.0,
        pressure_bar_abs=1.0,
        headspace_gas_percent=21.0,
        kla_source="estimate",
        vessel_class="flask",
        shaking_rpm=200,
    )

    assert abs(result["observed_rate_mmol_d"] - 0.5) < 1e-12
    assert result["kla_central_h"] == 20.0


def test_custom_henry_values_are_used():
    result = calculate_mass_transfer_assessment(
        gas_id="CO",
        observed_rate_value=0.20,
        observed_rate_unit="mmol_d",
        liquid_volume_ml=40.0,
        temperature_c=30.0,
        pressure_bar_abs=1.01325,
        headspace_gas_percent=10.0,
        kla_source="custom",
        custom_kla_h=10.0,
        henry_source="custom",
        custom_hcp_ref=1.0e-5,
        custom_henry_B_K=1200.0,
    )

    assert result["henry_overridden"] is True
    assert result["henry_reference_Hcp_mol_m3_Pa"] == 1.0e-5
    assert result["henry_B_K"] == 1200.0
    assert result["henry_source"] == "Custom user value"
