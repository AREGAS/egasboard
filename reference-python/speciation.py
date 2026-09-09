"""
pH-dependent speciation for CO2 and H2S.

This is kept separate from the physical Henry-law calculation because the
neutral dissolved gas is calculated first. The pH model is then applied to
that dissolved neutral pool.
"""

import math


def hydrogen_activity_from_ph(ph):
    """For the current ideal-dilute model, a(H+) = 10^(-pH)."""

    return 10.0 ** (-float(ph))


def calculate_carbonate_constants(temperature_k):
    """Return temperature-dependent K1 and K2 for the CO2 carbonate system."""

    T = float(temperature_k)

    # Temperature equations used in the current calculation.
    log_k1 = (
        -356.3094
        - (0.06091964 * T)
        + (21834.37 / T)
        + (126.8339 * math.log10(T))
        - (1684915.0 / (T * T))
    )

    log_k2 = (
        -107.8871
        - (0.03252849 * T)
        + (5151.79 / T)
        + (38.92561 * math.log10(T))
        - (563713.9 / (T * T))
    )

    k1 = 10.0 ** log_k1
    k2 = 10.0 ** log_k2

    pk1 = -log_k1
    pk2 = -log_k2

    return k1, k2, pk1, pk2


def calculate_co2_speciation(ph, temperature_k):
    """Calculate CO2*, HCO3- and CO3(2-) fractions."""

    hydrogen_activity = hydrogen_activity_from_ph(ph)
    k1, k2, pk1, pk2 = calculate_carbonate_constants(temperature_k)

    bicarbonate_ratio = k1 / hydrogen_activity
    carbonate_ratio = (k1 * k2) / (hydrogen_activity ** 2)

    reactive_factor = 1.0 + bicarbonate_ratio + carbonate_ratio

    fraction_co2 = 1.0 / reactive_factor
    fraction_bicarbonate = bicarbonate_ratio / reactive_factor
    fraction_carbonate = carbonate_ratio / reactive_factor

    return {
        "reactive_factor": reactive_factor,
        "pK1": pk1,
        "pK2": pk2,
        "fraction_CO2_star": fraction_co2,
        "fraction_HCO3": fraction_bicarbonate,
        "fraction_CO3": fraction_carbonate,
    }


def calculate_h2s_pka1(temperature_k):
    """Calculate the first H2S dissociation pKa used by (E)Gasboard."""

    T = float(temperature_k)

    pka1 = -98.080 + (5765.4 / T) + (15.0455 * math.log(T))

    return pka1


def calculate_h2s_pka2(temperature_k):
    """Return the second H2S dissociation pKa used by (E)Gasboard.

    The current v0.1 calculation uses pKa2 = 14.00. The temperature argument is
    kept in the function so both sulfide dissociation constants are handled
    through the same simple interface.
    """

    _ = float(temperature_k)
    pka2 = 14.00

    return pka2


def calculate_h2s_speciation(ph, temperature_k):
    """Calculate H2S, HS- and S2- fractions for the diprotic sulfide system."""

    hydrogen_activity = hydrogen_activity_from_ph(ph)

    pka1 = calculate_h2s_pka1(temperature_k)
    pka2 = calculate_h2s_pka2(temperature_k)

    k1 = 10.0 ** (-pka1)
    k2 = 10.0 ** (-pka2)

    hs_ratio = k1 / hydrogen_activity
    sulfide_ratio = (k1 * k2) / (hydrogen_activity ** 2)

    reactive_factor = 1.0 + hs_ratio + sulfide_ratio

    fraction_h2s = 1.0 / reactive_factor
    fraction_hs = hs_ratio / reactive_factor
    fraction_s2 = sulfide_ratio / reactive_factor

    return {
        "reactive_factor": reactive_factor,
        "pK1": pka1,
        "pK2": pka2,
        "fraction_H2S": fraction_h2s,
        "fraction_HS": fraction_hs,
        "fraction_S2": fraction_s2,
        "warning": None,
    }
