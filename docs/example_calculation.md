# Example calculation

This reproduces the CO development test case.

The fitted calibration is:

\[
A = 10000x + 500
\]

For a peak area of 150500:

\[
x = \frac{150500-500}{10000}=15.0\%
\]

Example bottle inputs:

- CO = 15.0%
- absolute pressure = 1.50 bar
- temperature = 30 °C
- bottle volume = 120 mL
- liquid volume = 50 mL
- Z = 1

The development test gives a total CO inventory of approximately 0.635 mmol.

At a later measurement with 8.0% CO and 1.35 bar absolute pressure, the development test gives approximately 0.305 mmol.

\[
\Delta n = 0.305 - 0.635 \approx -0.330\ \mathrm{mmol}
\]

This is reported neutrally as a **decrease of approximately 0.330 mmol**.

## Repeated-sampling interpretation

If gas or liquid was removed after the first measurement, the raw difference between the two bottle inventories also contains that physical sampling loss. Add `headspace_sample_mL` and/or `liquid_sample_mL` to the measurement file to retain the measured bottle amount while additionally calculating a sampling-corrected inventory.

For example, a sample volume entered on the first row is removed after that first measurement and is therefore added back only when interpreting later time points.
