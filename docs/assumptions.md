# Assumptions and limitations - v0.1

These assumptions define the v0.1 calculation.

## Bottle state

- Each row describes the measured state of one bottle at one time point.
- Pressure must be **absolute pressure**, not gauge pressure.
- Temperature is the bottle/headspace temperature at the time the pressure and gas composition apply.
- Bottle volume and liquid volume are treated as known values; headspace volume is their difference.
- Dissolved amounts are equilibrium estimates from Henry's law.

## Gas phase

- Water vapour is neglected in v0.1. A correction is planned for a later version.
- Entered pressure is treated as pressure of the modelled dry gas mixture.
- v0.1 uses the ideal gas law with Z = 1.

## Dissolved gas

- Henry solubilities are for water and are taken from the fixed parameter table selected from Sander (2023).
- Henry solubility is corrected for bottle temperature.
- Salting out is optional and uses NaCl-equivalent concentration. If omitted, pure-water Henry solubility is used.
- CO₂ and H₂S can include pH-dependent dissolved species when pH is supplied.

## Calibration

- Calibration and sample injections are assumed to be pressure-normalized before injection.
- Multipoint calibration uses linear regression. If the fitted intercept is negative, it is set to zero and the slope is refitted.

## Not included in v0.1

- water-vapour pressure correction (planned for a later version);
- full mixed-electrolyte/activity models;
- volatile fatty-acid speciation;
- formal propagation of analytical uncertainty;
- automatic mechanistic or biological interpretation.


## CO₂ interpretation

Physical CO₂ and estimated DIC are kept separate. `total_bottle_mmol` is always the physical total. In a short-term buffered
experiment with stable pH, physical CO₂ is the direct comparison with a manual
gas balance. When pH changes substantially, estimated DIC becomes more
important for interpretation.
