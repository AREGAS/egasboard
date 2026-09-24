# Assumptions and limitations - v0.1

These assumptions define the v0.1 calculation.

## Bottle state

- Each row describes the measured state of one bottle at one time point.
- Pressure must be **absolute pressure**, not gauge pressure.
- Temperature is the bottle/headspace temperature at the time the pressure and gas composition apply.
- Bottle volume and liquid volume are treated as known values; headspace volume is their difference.
- Dissolved amounts are equilibrium estimates from Henry's law.

## Repeated sampling

- `liquid_sample_mL` and `headspace_sample_mL` are optional and default to 0.
- Sampling volumes on a row are interpreted as material removed **after** the measurement on that row.
- The current row therefore remains the pre-sampling bottle state; the loss contributes only to subsequent corrected time points.
- `liquid_volume_mL` must contain the actual liquid volume at every measurement. The tool does not automatically subtract previous liquid samples.
- Sampling-corrected amounts are mass-balance inventories, not predictions of the exact concentration in an otherwise identical unsampled bottle.
- If material is removed at a time point where the relevant gas was not measured, the later sampling correction for that gas is incomplete and should not be interpreted as a full balance.

## Gas phase

- Water vapour is neglected in v0.1. A correction is planned for a later version.
- Entered pressure is treated as pressure of the modelled dry gas mixture.
- v0.1 uses the ideal gas law with Z = 1.

## Dissolved gas

- Henry solubilities are for water and are taken from the fixed parameter table selected from Sander (2023).
- Henry solubility is corrected for bottle temperature.
- Salting out is optional and uses NaCl-equivalent concentration. If omitted, pure-water Henry solubility is used.
- CO2 and H2S can include pH-dependent dissolved species when pH is supplied.

## CO2 interpretation

Physical CO2 and estimated DIC are kept separate. `total_bottle_mmol` is always the physical molecular total.

Estimated DIC is strongly pH-dependent. In quantitative CO2 utilization or carbon-balance experiments, pH should preferably be measured at each time point. Sampling-corrected inorganic carbon uses the pH entered for each sampling event.

## Calibration

- Calibration and sample injections are assumed to be pressure-normalized before injection.
- Multipoint calibration uses linear regression. If the fitted intercept is negative, it is set to zero and the slope is refitted.

## Not included in v0.1

- water-vapour pressure correction (planned for a later version);
- full mixed-electrolyte/activity models;
- volatile fatty-acid speciation;
- formal propagation of analytical uncertainty;
- automatic mechanistic or biological interpretation.
## Rate and mass-transfer screening

- The mass-transfer module currently evaluates gas uptake from the headspace into the liquid.
- CO2/H2S mass-transfer screening uses molecular gas transfer only; reactive absorption can change the effective uptake rate.
- Built-in kLa values are literature-based screening estimates for comparable shaken batch systems, not universal vessel constants.
- The built-in estimate range is ±50% around the central screening value.
- The 400 rpm values are higher-uncertainty extrapolations.
- Vessel geometry, fill fraction, orbital diameter, baffling, viscosity, surfactants, medium composition and gas diffusivity can materially change the true kLa.
- A measured or directly relevant literature kLa should be used whenever available. The mass-transfer module also allows user replacement of the built-in Henry Hcp/B values.
- `MTRmax = kLa × V_L × C*` assumes the limiting case `C_L = 0`; it is therefore a maximum transfer-capacity screen, not a direct measurement of the actual transfer rate.



## Rate and transfer analysis

- Linear rate fitting assumes the selected interval is reasonably represented by a straight line.
- The mass-transfer screen uses the molecular-gas driving force and currently evaluates gas uptake, not outgassing.
- Built-in kLa values are screening estimates for comparable shaken batch systems and remain user-overridable.
- Explore & predict is a physical transfer-capacity model, not a biological growth or kinetic prediction.
