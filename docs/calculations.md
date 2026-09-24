# How (E)Gasboard calculates gas in a closed incubation - v0.1

## What is a microcosm or closed incubation?

A microcosm or closed incubation is a sealed bottle containing a known amount of liquid and a gas-filled space above it, the **headspace**. During an experiment, gases can appear, disappear or redistribute between the headspace and the liquid.

A headspace measurement therefore tells you the gas composition of the gas phase, but not directly how much gas is present in the complete bottle. Here, that measurement is combined with the headspace measurement with bottle pressure, temperature, bottle geometry and gas solubility to estimate the gas amount in the bottle.

The calculation route is:

**GC peak area -> gas concentration (%) -> partial pressure -> headspace amount -> molecular dissolved amount -> total bottle amount**

For CO₂ and H₂S, dissolved acid-base species can additionally be included when pH is supplied. Longitudinal batch data can optionally include gas and liquid sample volumes so that material physically removed during earlier sampling events is tracked separately.

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
| Liquid sample volume | V_sample,liquid | Optional liquid volume removed after a measurement |
| Headspace sample volume | V_sample,gas | Optional headspace gas volume removed after a measurement |
| Sampled amount | n_sample | Amount physically removed in a gas and/or liquid sample |
| Cumulative sampled amount | N_sample,<i | Total amount removed before the current time point |
| Sampling-corrected amount | n_corrected | Current bottle amount plus cumulative previous sampling loss |
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

## Step 9 - Optional sampling-loss correction for time-series experiments

Repeated headspace or liquid sampling physically removes material from a closed bottle. When sampling volumes are supplied, (E)Gasboard therefore keeps two quantities separate:

1. the amount currently measured in the bottle; and
2. a sampling-corrected mass-balance inventory.

Sampling volumes entered on row *i* are assumed to be removed **after** the measurement on row *i*. They therefore first contribute to the correction at the next time point.

For the gas sample:

\[
n_{sample,gas,i}
=
n_{headspace,i}
\frac{V_{sample,gas,i}}{V_{headspace,i}}
\]

For the liquid sample, using the molecular dissolved gas pool:

\[
n_{sample,liquid,i}
=
n_{molecular,dissolved,i}
\frac{V_{sample,liquid,i}}{V_{liquid,i}}
\]

The amount removed before time point *i* is:

\[
N_{sample,<i}
=
\sum_{j<i}
\left(n_{sample,gas,j}+n_{sample,liquid,j}\right)
\]

and the sampling-corrected molecular inventory is:

\[
n_{corrected,i}
=
n_{total,bottle,i}+N_{sample,<i}
\]

The entered liquid volume is **not** automatically changed by the sampling field. `liquid_volume_mL` must describe the actual liquid volume present at every measurement.

The correction is a mass-balance inventory. It does not predict the exact concentration that would have existed in an unsampled bottle, because sampling also changes the headspace/liquid-volume ratio and can therefore affect later gas-liquid partitioning.

### CO2 / inorganic carbon sampling

For CO2, the molecular correction above remains available. When pH is available, a second carbon-balance quantity is calculated:

\[
n_{TIC,i}=n_{CO2,headspace,i}+n_{DIC,i}
\]

Liquid sampling removes the estimated DIC concentration present at that time point:

\[
n_{sample,DIC,i}
=
n_{DIC,i}
\frac{V_{sample,liquid,i}}{V_{liquid,i}}
\]

while a headspace sample removes molecular CO2. The cumulative previous losses are added to the current headspace-CO2 + DIC inventory.

**pH is critical for this quantity.** DIC depends strongly on the CO2*/HCO3-/CO3^2- distribution. Even small pH changes can substantially change estimated DIC. For quantitative CO2 utilization or carbon-balance experiments, pH should preferably be measured at each time point rather than assumed constant.

### H2S / total sulfide sampling

H2S is treated analogously. The molecular H2S correction uses dissolved molecular H2S. When pH is available, the reactive-pool correction uses gaseous H2S plus estimated dissolved total sulfide (H2S + HS- + S2-).

If a required gas measurement or pH value is missing at a sampling event, later reactive-pool corrections that depend on that event are reported as incomplete rather than silently treating the removed amount as zero.

## Rate and gas-liquid mass-transfer screening

The separate **Rate & mass transfer** module can fit a straight line to a selected Batch time-series interval:

\[
n(t)=mt+b
\]

The slope is retained as a signed rate: negative for gas uptake and positive for gas production. R² and the number of fitted points are reported. The current gas-transfer screen then evaluates whether gas-liquid transfer can support an observed **gas uptake** rate.

The equilibrium molecular dissolved concentration is first calculated from the current headspace conditions:

\[
C^*=H_s^{cp}(T)p_i
\]

For gas uptake, the maximum transfer capacity occurs when the bulk dissolved concentration approaches zero:

\[
MTR_{max}=k_LaV_LC^*
\]

where:

- \(k_La\) is the volumetric gas-liquid mass-transfer coefficient in h⁻¹;
- \(V_L\) is liquid volume;
- \(C^*\) is the equilibrium molecular dissolved concentration.

The transfer-demand ratio is:

\[
D=\frac{r_{uptake}}{MTR_{max}}
\]

A value of \(D=1\) means the observed uptake would require the bulk dissolved concentration to approach zero. A value above 1 means the observed uptake exceeds the calculated maximum transfer capacity for the supplied kLa and gas conditions.

The minimum kLa required to support the entered rate even at \(C_L=0\) is:

\[
k_La_{min}=\frac{r_{uptake}}{V_LC^*}
\]

### Rough kLa screening estimates

A measured or otherwise independently determined kLa is preferred. When none is available, (E)Gasboard offers deliberately broad screening estimates for ordinary **unbaffled orbital shaking**:

| Vessel / typical working-volume class | 100 rpm | 150 rpm | 200 rpm | 400 rpm* |
| --- | ---: | ---: | ---: | ---: |
| Tube (10-20 mL) | 8 | 15 | 30 | 80 |
| Flask (20-120 mL) | 4 | 12 | 20 | 60 |
| Small bottle (120-500 mL) | 5 | 10 | 15 | 40 |
| Large bottle (0.5-2 L) | 2 | 5 | 8 | 25 |

Values are central screening kLa estimates in h⁻¹. The interface displays an indicative ±50% range around each value. The 400 rpm values are higher-uncertainty extrapolations.

These values are **not universal constants**. Published work shows strong dependence on vessel geometry, filling volume, orbital diameter, baffling, medium properties and operating conditions. The table is a first-pass screening estimate. Direct gas-specific batch data are shown where available, and the user can replace kLa with a more representative measured or literature value.

Relevant literature includes:

- Jang N et al. (2017), *Determination of volumetric gas-liquid mass transfer coefficient of carbon monoxide in a batch cultivation system using kinetic simulations*, DOI: 10.1016/j.biortech.2017.05.023. Their vial-scale CO batch data were reproduced with kLa ≈ 13 h⁻¹ under the studied conditions.
- Schick B et al. (2025), *Effects of carbon monoxide supply on gas fermentations in serum bottles investigated by online monitoring of gas transfer rates*, DOI: 10.1016/j.bej.2025.109838. Direct serum-bottle experiments showed strong effects of shaking frequency and declining headspace CO on the available CO-transfer rate.
- Zhang H et al. (2005), *Computational-fluid-dynamics analysis of mixing and gas-liquid mass transfer in shake flasks*, DOI: 10.1042/BA20040082. Reported 250 mL shake-flask kLa values spanning approximately 10-100 h⁻¹ across 100-300 rpm, 20-60 mm orbit diameters and 25-100 mL fill volumes.
- Logan BE & Kohler D (2001), *Oxygen mass-transfer coefficients for different sample containers used in the headspace biochemical oxygen demand test*, DOI: 10.2175/106143001X138697. Reported an average kLa of 8.0 h⁻¹ (5.4-9.9 h⁻¹) for partially filled 28-160 mL containers shaken at 200 rpm.
- Takeshita T et al. (1993), *Development of a dissolved hydrogen sensor and its application to evaluation of hydrogen mass transfer*, DOI: 10.1016/0922-338X(93)90073-H. Directly determined hydrogen kLa in culture systems and compared it with oxygen transfer.
- Beckers L et al. (2015), *Investigation of the links between mass transfer conditions, dissolved hydrogen concentration and biohydrogen production by Clostridium butyricum CWBI1009*, DOI: 10.1016/j.bej.2015.01.008. Shows the importance of system-specific hydrogen transfer and departures from Henry equilibrium.
- Lamb SC & Garver JC (1980), *Batch- and continuous-culture studies of a methane-utilizing mixed culture*, DOI: 10.1002/bit.260221009. Reports a directly determined methane kLa for their culture system.
- Mayrhofer P et al. (2021), *Shake tube perfusion cell cultures are suitable tools for the prediction of limiting substrate, CSPR, bleeding strategy, growth and productivity behavior*, DOI: 10.1002/jctb.6848. Discusses >60 h⁻¹ at 10 mL/180 rpm and ~50 h⁻¹ at 20 mL/220 rpm for 50 mL shaken tubes.
- Klöckner W et al. (2013), *Correlation between mass transfer coefficient kLa and relevant operating parameters in cylindrical disposable shaken bioreactors on a bench-to-pilot scale*, DOI: 10.1186/1754-1611-7-28. Demonstrates the strong dependence of kLa on reactor diameter, shaking frequency, fill volume, viscosity, diffusivity and shaking diameter.

Explore & predict mode uses the same transfer equations interactively. Changing kLa, headspace concentration, pressure, liquid volume or Henry-law assumptions updates the predicted transfer capacity and minimum required kLa in real time.

The module currently screens gas **uptake**. Gas-production/outgassing limitation requires the dissolved supersaturation driving force and is not yet implemented. For CO2 and H2S, the screen uses molecular gas transfer only; rapid acid-base reaction or chemical consumption can change the effective absorption rate relative to this simple physical-transfer model.

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


## Gas dosing

Gas dosing can use either a dissolved concentration target or an equilibrated headspace target.

For a dissolved target, Henry's law is inverted to obtain the required target-gas partial pressure. For CO2 and H2S, the target may refer to the molecular dissolved species or, when pH is supplied, the estimated total dissolved pool.

For a headspace target, `%` or `ppmv` is converted to a mole fraction, and the final equilibrium must satisfy:

\[
p_i = y_{target} P_{final}
\]

The amount added is solved from the gas-liquid mass balance. The target gas can partition between headspace and liquid, while the non-target fraction of the dosing mixture is assumed to remain in the headspace. The pressure increase caused by the added dosing mixture is included in the final headspace concentration.

If the requested headspace concentration cannot be reached with the entered dosing-mixture composition, the calculation returns an error.

### Gas-phase concentration units

`ppmv` means parts per million by volume. For the ideal gas mixtures used by (E)Gasboard, volume fraction and mole fraction are treated as equivalent.

\[
1\% = 10000\;ppmv
\]

Thus:

- 500 ppmv = 0.05%
- 1000 ppmv = 0.1%
- 10000 ppmv = 1%

`ppmv` is a gas-phase composition unit and is not a mass-based ppm concentration.

### Gas-transfer estimates

kLa depends strongly on vessel geometry, liquid volume, shaking conditions and medium composition. (E)Gasboard therefore uses literature-based screening estimates for comparable batch systems where available. These values are not exact system-specific measurements, and both kLa and the Henry Hcp/B values used in the mass-transfer screen can be replaced by the user.

(If you disagree or have more representative values, please let me know!)

---

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
