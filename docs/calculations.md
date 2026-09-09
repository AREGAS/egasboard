# How (E)Gasboard calculates gas in a closed incubation - v0.1

## What is a microcosm or closed incubation?

A microcosm or closed incubation is a sealed bottle containing a known amount of liquid and a gas-filled space above it, the **headspace**. During an experiment, gases can appear, disappear or redistribute between the headspace and the liquid.

A headspace measurement therefore tells you the gas composition of the gas phase, but not directly how much gas is present in the complete bottle. Here, that measurement is combined with the headspace measurement with bottle pressure, temperature, bottle geometry and gas solubility to estimate the gas amount in the bottle.

The calculation route is:

**GC peak area -> gas concentration (%) -> partial pressure -> headspace amount -> molecular dissolved amount -> total bottle amount**

For CO₂ and H₂S, dissolved acid-base species can additionally be included when pH is supplied.

---

## Parameters used in the equations

| Parameter | Symbol | Meaning |
| --- | --- | --- |
| GC peak area | A | Instrument response measured for a calibration standard or sample |
| Gas concentration | x | Percentage of the headspace made up by the selected gas |
| Gas fraction | yᵢ | Gas concentration expressed as a fraction between 0 and 1 |
| Absolute bottle pressure | P_abs | Total pressure inside the bottle |
| Gas partial pressure | pᵢ | Pressure contributed by the selected gas alone |
| Bottle volume | V_bottle | Internal volume of the complete bottle |
| Liquid volume | V_liquid | Volume occupied by the liquid |
| Headspace volume | V_headspace | Gas-filled volume above the liquid |
| Bottle temperature | T | Temperature of the bottle when pressure and gas composition are measured |
| Compressibility factor | Z | Fixed at 1 in v0.1 |
| Gas constant | R | 8.314462618 J mol⁻¹ K⁻¹ |
| Henry solubility | Hcp | Dissolved concentration produced by a given gas partial pressure |
| Gas amount | n | Amount of gas in moles; results are reported in mmol |

All calculations are performed internally in SI units: Pa, m³, K and mol.

---

## Step 1 - Convert GC peak area to gas concentration

When GC peak area is used, calibration standards with known gas concentrations are fitted with a straight line:

\[
A = mx+b
\]

where:

- **A** = peak area
- **x** = gas concentration in %
- **m** = fitted slope
- **b** = fitted intercept

The gas concentration of a sample is then:

\[
x_{sample}=\frac{A_{sample}-b}{m}
\]

Replicate standards remain separate points. The calibration plot shows the fitted line and R². Samples outside the calibration range are still calculated but receive a warning.

---

## Step 2 - Convert gas concentration to partial pressure

Gas percentage is first converted to a dimensionless gas fraction:

\[
y_i=\frac{x_i}{100}
\]

Absolute pressure entered in bar is converted to pascals:

\[
P_{abs}[Pa]=P_{abs}[bar]\times10^5
\]

The partial pressure of the selected gas is then:

\[
p_i=y_iP_{abs}
\]

For example, 10% CO at 1.5 bar absolute means that CO contributes 10% of the total bottle pressure.

---

## Step 3 - Calculate the amount in the headspace

The headspace is the part of the bottle not occupied by liquid:

\[
V_{headspace}=V_{bottle}-V_{liquid}
\]

Volumes entered in mL are converted to m³ and temperature entered in °C is converted to K:

\[
T[K]=T[^{\circ}C]+273.15
\]

The amount of the selected gas in the headspace is calculated with:

\[
n_{headspace}=\frac{p_iV_{headspace}}{ZRT}
\]

Here, **n_headspace** is the number of moles physically present in the gas phase. v0.1 uses **Z = 1** and is intended for normal incubation pressures.

---

## Step 4 - Correct Henry solubility for bottle temperature

A gas also dissolves in the liquid. The calculation uses the Henry-solubility convention:

\[
H_s^{cp}=\frac{c}{p}
\]

where **c** is dissolved concentration and **p** is gas partial pressure. The unit is mol m⁻³ Pa⁻¹.

Each gas has a reference Henry solubility at 25 °C (298.15 K). This value is adjusted to the measured bottle temperature using the temperature parameter **B** from Sander (2023):

\[
H_s^{cp}(T)=H_s^{cp,*}\exp\left[B\left(\frac{1}{T}-\frac{1}{298.15}\right)\right]
\]

where:

- **Hcp\*** = reference Henry solubility at 25 °C
- **Hcp(T)** = Henry solubility used at the sample temperature
- **B** = temperature-dependence parameter in K
- **T** = bottle temperature in K

All Henry-solubility constants, temperature parameters and stored temperature-range metadata in v0.1 are selected from Sander (2023).

---

## Step 5 - Optional salting-out correction

Dissolved salts generally lower gas solubility, a process commonly called **salting out**.

NaCl-equivalent concentration is optional. If it is blank or 0, pure-water Henry solubility is used.

When NaCl-equivalent concentration is supplied, the calculation applies the Weisenberger-Schumpe correction where a gas-specific parameter is available:

\[
\log_{10}\left(\frac{c_{water}}{c_{salt}}\right)=K_sc_{NaCl}
\]

where:

- **c_water** = predicted dissolved concentration in pure water
- **c_salt** = predicted dissolved concentration after salt correction
- **c_NaCl** = NaCl concentration in mol/L
- **K_s** = salting-out coefficient

This is an NaCl-equivalent approximation, not a full mixed-electrolyte calculation. CO has no gas-specific parameter in the current salinity model; non-zero salinity for CO is therefore left uncorrected and flagged.

---

## Step 6 - Calculate the dissolved amount

The Henry solubility used for the sample is multiplied by the gas partial pressure:

\[
c_{dissolved}=H_s^{cp}(T)p_i
\]

This gives the equilibrium molecular dissolved concentration. Multiplying by liquid volume gives the dissolved amount:

\[
n_{dissolved}=c_{dissolved}V_{liquid}
\]

---

## Step 7 - For CO₂ and H₂S, optionally include pH-dependent species

Henry's law first describes the neutral dissolved form. CO₂ and H₂S can then dissociate in water. If pH is supplied, both dissociation steps are included.

### CO₂ / carbonate

\[
CO_2^*\rightleftharpoons H^+ + HCO_3^-
\]

\[
HCO_3^-\rightleftharpoons H^+ + CO_3^{2-}
\]

At 25 °C the implemented values are:

- pKa₁ = 6.352
- pKa₂ = 10.329

Both pKa values are recalculated for the sample temperature. **CO₂\*** refers to physically dissolved CO₂ before acid-base speciation.

### H₂S / sulfide

\[
H_2S\rightleftharpoons H^+ + HS^-
\]

\[
HS^-\rightleftharpoons H^+ + S^{2-}
\]

At 25 °C the implemented values are:

- pKa₁ ≈ 6.980
- pKa₂ = 14.00

H₂S, HS⁻ and S²⁻ are all included. Around neutral pH, the S²⁻ fraction is normally extremely small.

The documentation states the pKa values actually implemented rather than assigning separate literature references to these standard acid-base equations.

---

## Step 8 - Calculate the total bottle amount

The main total always means physical gas:

\[
n_{total}=n_{headspace}+n_{molecular,dissolved}
\]

For CO2 and H2S, estimated DIC or estimated dissolved total sulfide is reported separately.

## Main assumptions

- Calibration and sample injections are assumed to be pressure-normalized before injection.
- Dissolved amounts are equilibrium estimates from Henry's law.
- Water vapour is neglected in v0.1. A correction is planned for a later version.
- v0.1 uses the ideal gas law with Z = 1.

## References

**Henry solubility, temperature dependence and stored temperature ranges**  
Sander, R. (2023). *Compilation of Henry's law constants (version 5.0.0) for water as solvent*. Atmospheric Chemistry and Physics, 23, 10901-12440.  
https://doi.org/10.5194/acp-23-10901-2023

**Optional salting-out correction**  
Weisenberger, S. & Schumpe, A. (1996). *Estimation of gas solubilities in salt solutions at temperatures from 273 K to 363 K*. AIChE Journal, 42, 298-300.  
https://doi.org/10.1002/aic.690420130


## CO₂: physical CO₂ versus estimated DIC

For CO₂, two related quantities are reported separately.

### Physical CO₂

\[
n_{\mathrm{CO_2,physical}}
=
n_{\mathrm{CO_2,headspace}}
+
n_{\mathrm{CO_2^*,dissolved}}
\]

This is also the generic `total_bottle_mmol` for CO2.
### Estimated dissolved inorganic carbon

When pH is supplied, the dissolved carbonate pool is additionally estimated as

\[
\mathrm{DIC}
=
\mathrm{CO_2^*}
+
\mathrm{HCO_3^-}
+
\mathrm{CO_3^{2-}}
\]

using the implemented temperature-dependent pKa values.

This does not replace the physical CO₂ result. It is an additional
carbonate-system quantity. The distinction matters especially when pH changes,
because carbonate speciation can shift independently of molecular CO2.
