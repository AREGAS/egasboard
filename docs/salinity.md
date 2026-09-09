# Optional salting-out correction - v0.1

Dissolved salts usually reduce the solubility of gases in water. This is commonly called **salting out**.

NaCl-equivalent concentration is optional in (E)Gasboard. If the value is missing, blank or 0, pure-water Henry solubility is used.

## What the user enters

The current input is:

`salinity_g_L_NaCl`

This means **grams of NaCl-equivalent per litre**.

It is not a full mixed-electrolyte calculation.

## What (E)Gasboard does

First, the pure-water Henry solubility is corrected for the measured bottle temperature. If non-zero salinity is supplied, (E)Gasboard then applies the Weisenberger-Schumpe salting-out relation:

\[
\log_{10}\left(\frac{c_{water}}{c_{salt}}\right)=K_sc_{NaCl}
\]

where:

- **c_water** = dissolved concentration predicted for pure water;
- **c_salt** = dissolved concentration after the salt correction;
- **c_NaCl** = NaCl concentration in mol/L;
- **K_s** = gas- and salt-dependent salting-out coefficient.

Because (E)Gasboard uses the Henry-solubility convention Hcp = c/p, lower dissolved concentration means a lower effective Hcp.

## Current scope

Gas-specific parameters are available in the selected salinity model for CO₂, CH₄, NO, N₂O, H₂S, ethane, N₂ and O₂.

The model does not provide a CO gas parameter. If a non-zero NaCl-equivalent value is entered for CO, (E)Gasboard therefore keeps the pure-water Hcp and adds a QC warning instead of inventing a correction.

The model warns at very high NaCl-equivalent concentrations.

## Reference

Weisenberger, S. & Schumpe, A. (1996). *Estimation of gas solubilities in salt solutions at temperatures from 273 K to 363 K*. AIChE Journal, 42, 298-300.  
https://doi.org/10.1002/aic.690420130
