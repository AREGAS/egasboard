/*
 * (E)Gasboard v0.1 - pH-dependent speciation
 *
 * The neutral dissolved gas is calculated first with Henry's law. These
 * functions then determine how much additional dissolved material is present
 * as acid/base species at the entered pH.
 *
 * The equations intentionally mirror reference-python/speciation.py.
 */

export function hydrogenActivityFromPh(ph) {
  return 10.0 ** (-Number(ph));
}

export function calculateCarbonateConstants(temperatureK) {
  const T = Number(temperatureK);

  const logK1 =
    -356.3094 -
    (0.06091964 * T) +
    (21834.37 / T) +
    (126.8339 * Math.log10(T)) -
    (1684915.0 / (T * T));

  const logK2 =
    -107.8871 -
    (0.03252849 * T) +
    (5151.79 / T) +
    (38.92561 * Math.log10(T)) -
    (563713.9 / (T * T));

  return {
    k1: 10.0 ** logK1,
    k2: 10.0 ** logK2,
    pK1: -logK1,
    pK2: -logK2
  };
}

export function calculateCo2Speciation(ph, temperatureK) {
  const hydrogenActivity = hydrogenActivityFromPh(ph);
  const constants = calculateCarbonateConstants(temperatureK);

  const bicarbonateRatio = constants.k1 / hydrogenActivity;
  const carbonateRatio =
    (constants.k1 * constants.k2) / (hydrogenActivity ** 2);

  const reactiveFactor = 1.0 + bicarbonateRatio + carbonateRatio;

  return {
    reactive_factor: reactiveFactor,
    pK1: constants.pK1,
    pK2: constants.pK2,
    fraction_CO2_star: 1.0 / reactiveFactor,
    fraction_HCO3: bicarbonateRatio / reactiveFactor,
    fraction_CO3: carbonateRatio / reactiveFactor
  };
}

export function calculateH2sPka1(temperatureK) {
  const T = Number(temperatureK);
  return -98.080 + (5765.4 / T) + (15.0455 * Math.log(T));
}

export function calculateH2sPka2(temperatureK) {
  // v0.1 deliberately uses a fixed second sulfide pKa of 14.00.
  Number(temperatureK); // keep the interface symmetric and validate coercion.
  return 14.00;
}

export function calculateH2sSpeciation(ph, temperatureK) {
  const hydrogenActivity = hydrogenActivityFromPh(ph);
  const pK1 = calculateH2sPka1(temperatureK);
  const pK2 = calculateH2sPka2(temperatureK);

  const k1 = 10.0 ** (-pK1);
  const k2 = 10.0 ** (-pK2);

  const hsRatio = k1 / hydrogenActivity;
  const sulfideRatio = (k1 * k2) / (hydrogenActivity ** 2);
  const reactiveFactor = 1.0 + hsRatio + sulfideRatio;

  return {
    reactive_factor: reactiveFactor,
    pK1,
    pK2,
    fraction_H2S: 1.0 / reactiveFactor,
    fraction_HS: hsRatio / reactiveFactor,
    fraction_S2: sulfideRatio / reactiveFactor,
    warning: null
  };
}
