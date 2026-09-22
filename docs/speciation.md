# pH-dependent CO₂ and H₂S speciation - v0.1

Henry's law tells (E)Gasboard how much of the **neutral gas species** dissolves in the liquid. For CO₂ and H₂S, that neutral dissolved species can subsequently gain or lose protons depending on pH.

This pH step is optional. If no pH is supplied, (E)Gasboard reports only the neutral dissolved amount calculated from Henry's law.

## Carbon dioxide / carbonate

The neutral dissolved form is written as **CO₂\***. It can dissociate in two steps:

\[
CO_2^* \rightleftharpoons H^+ + HCO_3^-
\]

\[
HCO_3^- \rightleftharpoons H^+ + CO_3^{2-}
\]

The implemented values at 25 °C are:

- pKa₁ = 6.352
- pKa₂ = 10.329

Both pKa values are recalculated for the bottle temperature of each sample.

The total dissolved inorganic-carbon pool is the sum of CO₂*, HCO₃⁻ and CO₃²⁻. (E)Gasboard reports the fraction of each species as well as the total dissolved amount.

**Important for CO₂ utilization and carbon-balance experiments:** estimated DIC is strongly dependent on pH. Even small pH changes can materially change the inferred HCO₃⁻/CO₃²⁻ pool. For quantitative DIC balances, including sampling-corrected inorganic-carbon balances, pH should therefore preferably be measured at each time point.

## Hydrogen sulfide / sulfide

The neutral dissolved form is H₂S. It also dissociates in two steps:

\[
H_2S \rightleftharpoons H^+ + HS^-
\]

\[
HS^- \rightleftharpoons H^+ + S^{2-}
\]

The implemented values at 25 °C are:

- pKa₁ ≈ 6.980
- pKa₂ = 14.00

H₂S, HS⁻ and S²⁻ are all included in the dissolved sulfide pool. Around neutral pH, S²⁻ is normally only a very small fraction, but it is not omitted from the calculation.

## Why no separate speciation reference is listed

(E)Gasboard documents the exact pKa values and equations used by the software rather than attaching separate literature references to these standard acid-base relationships. This makes the implemented calculation directly visible to the user.
