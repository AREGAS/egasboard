from calculations import calculate_gas_state


def test_co_worked_example():
    result = calculate_gas_state(
        gas_id="CO",
        gas_percent=15.0,
        pressure_bar_abs=1.50,
        temperature_c=30.0,
        bottle_volume_ml=120.0,
        liquid_volume_ml=50.0,
        compressibility_factor=1.0,
    )

    # The exact value changed slightly from the earlier document because this
    # demo uses R = 8.314462618 instead of the rounded 8.314 value.
    assert abs(result["headspace_mmol"] - 0.62487) < 0.0001
    assert result["total_bottle_mmol"] > result["headspace_mmol"]


def test_o2_dosing_example_with_salinity():
    from calculations import calculate_required_gas_addition

    result = calculate_required_gas_addition(
        gas_id="O2",
        target_dissolved_umol_l=150.0,
        bottle_volume_ml=120.0,
        liquid_volume_ml=100.0,
        temperature_c=25.0,
        salinity_g_l_nacl=33.0,
        initial_gas_percent=0.0,
        initial_pressure_bar_abs=1.01325,
        dose_gas_percent=100.0,
        dose_pressure_bar_abs=1.01325,
    )

    assert abs(result["required_target_gas_mmol"] - 0.1275654) < 1e-6
    assert abs(result["required_dose_mix_volume_mL"] - 3.12094) < 1e-4


def test_headspace_ppmv_dosing_target():
    from calculations import calculate_required_gas_addition

    result = calculate_required_gas_addition(
        gas_id="CO",
        target_dissolved_umol_l=None,
        target_mode="headspace",
        target_headspace_percent=0.05,
        bottle_volume_ml=120.0,
        liquid_volume_ml=100.0,
        temperature_c=25.0,
        salinity_g_l_nacl=0.0,
        initial_gas_percent=0.0,
        initial_pressure_bar_abs=1.01325,
        dose_gas_percent=100.0,
        dose_pressure_bar_abs=1.01325,
    )

    assert abs(result["final_headspace_ppmv"] - 500.0) < 1e-9
    assert abs(result["final_headspace_percent"] - 0.05) < 1e-12
    assert result["required_dose_mix_volume_mL"] > 0


def test_headspace_target_rejects_too_dilute_dosing_mix():
    from calculations import calculate_required_gas_addition
    import pytest

    with pytest.raises(ValueError, match="cannot be reached"):
        calculate_required_gas_addition(
            gas_id="CO",
            target_dissolved_umol_l=None,
            target_mode="headspace",
            target_headspace_percent=0.05,
            bottle_volume_ml=120.0,
            liquid_volume_ml=100.0,
            temperature_c=25.0,
            salinity_g_l_nacl=0.0,
            initial_gas_percent=0.0,
            initial_pressure_bar_abs=1.01325,
            dose_gas_percent=0.05,
            dose_pressure_bar_abs=1.01325,
        )
