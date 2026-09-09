# Gas constants and sources

(E)Gasboard v0.1 uses one fixed Henry-solubility parameter set per gas. The
calculation engine reads these values from `data/gas_properties.csv`.

All Henry-solubility values and temperature parameters used by (E)Gasboard are
selected from the compilation of **Sander (2023)**. The underlying primary
papers compiled by Sander are therefore not separately cited in the (E)Gasboard
methods. Where a temperature range is stored, it is treated as metadata from
the selected Sander parameterization and is used only for a QC warning.

| Gas | Name | CAS RN | Hcp at 298.15 K (mol m⁻³ Pa⁻¹) | B (K) | Source |
| --- | --- | --- | ---: | ---: | --- |
| CO | Carbon monoxide | 630-08-0 | 9.70 × 10⁻⁶ | 1300 | Sander (2023) |
| CO₂ | Carbon dioxide | 124-38-9 | 3.40 × 10⁻⁴ | 2300 | Sander (2023) |
| CH₄ | Methane | 74-82-8 | 1.40 × 10⁻⁵ | 1600 | Sander (2023) |
| NO | Nitric oxide | 10102-43-9 | 1.90 × 10⁻⁵ | 1600 | Sander (2023) |
| N₂O | Nitrous oxide | 10024-97-2 | 2.40 × 10⁻⁴ | 2600 | Sander (2023) |
| H₂S | Hydrogen sulfide | 7783-06-4 | 1.00 × 10⁻³ | 2100 | Sander (2023) |
| C₂H₆ | Ethane | 74-84-0 | 1.90 × 10⁻⁵ | 2400 | Sander (2023) |
| N₂ | Nitrogen | 7727-37-9 | 6.40 × 10⁻⁶ | 1300 | Sander (2023) |
| O₂ | Oxygen | 7782-44-7 | 1.30 × 10⁻⁵ | 1500 | Sander (2023) |

## Henry-law reference

Sander, R. (2023). Compilation of Henry's law constants (version 5.0.0) for
water as solvent. *Atmospheric Chemistry and Physics*, 23, 10901-12440.
https://doi.org/10.5194/acp-23-10901-2023
