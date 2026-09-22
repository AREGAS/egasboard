# Input and output format

## Measurement workbook

Use **one row for one bottle at one time point**.

Bottle conditions are written once in that row. Each measured gas gets its own column, and the value in that gas column is the **GC peak area**.

Example:

| experiment_id | sample_id | time_h | pressure_bar_abs | temperature_C | bottle_volume_mL | liquid_volume_mL | liquid_sample_mL | headspace_sample_mL | CO | CO2 | CH4 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| WK3_example | 1_CO | 3.63 | 1.583 | 23 | 120 | 39.56 | 0.50 | 0.10 | 829.1 | 274.4 | 2.4 |
| WK3_example | 1_CO | 16.17 | 1.545 | 23 | 120 | 39.06 | 1.50 | 0.10 | 408.2 | 455.3 | 7.5 |

Here, `CO`, `CO2` and `CH4` are gas IDs. Their cells contain peak areas.

### Required shared columns

- `sample_id`
- `time_h`
- `pressure_bar_abs`
- `temperature_C`
- `bottle_volume_mL`
- `liquid_volume_mL`

### Optional shared columns

- `experiment_id` - defaults to `Experiment 1` when absent
- `salinity_g_L_NaCl` - NaCl-equivalent g/L; defaults to 0
- `pH` - used for CO2/H2S speciation when supplied
- `liquid_sample_mL` - liquid volume removed **after** the measurement on that row; defaults to 0
- `headspace_sample_mL` - gas volume removed from the headspace **after** the measurement on that row; defaults to 0

Sampling volumes are applied only to subsequent time points. The actual `liquid_volume_mL` must still be supplied at each measurement. The tool does not automatically reduce later liquid volumes.

### Gas columns

Use a recognized gas ID as the column header, for example:

`CO`, `CO2`, `CH4`, `O2`, `H2S`, `N2O`, `NO`, `N2`, `C2H6`

A blank gas cell means that gas was not measured at that time point. If sampling occurred at a time point where a gas was not measured, the sampling correction for that gas cannot be reconstructed reliably and later corrected values are flagged as incomplete.

Internally, the tool converts this wide table into individual gas observations for calibration and calculation. You do not need to arrange the measurement file that way yourself.

## Calibration workbook

Calibration stays in long format because every row is one calibration observation:

| gas_id | calibration_id | gas_percent | peak_area |
|---|---|---:|---:|
| CO | CO_0 | 0 | 500 |
| CO | CO_10 | 10 | 100500 |
| CO2 | CO2_5 | 5 | 42000 |

Calibration replicates remain separate rows.

## Output

The main amount columns are:

- `total_bottle_mmol` - physical gas currently in the headspace + molecular dissolved gas
- `headspace_mmol`
- `molecular_dissolved_mmol`

When sampling volumes are supplied, the detailed calculation also reports:

- `sampled_headspace_mmol`
- `sampled_liquid_molecular_mmol`
- `sampled_total_molecular_mmol`
- `cumulative_sampled_molecular_mmol`
- `sampling_corrected_total_mmol`

The corrected value is the current measured bottle inventory plus material removed during previous sampling events. It does not replace `total_bottle_mmol`.

If pH is supplied:

- CO2 can report `estimated_DIC_mmol` and a separate sampling-corrected total inorganic-carbon inventory;
- H2S can report `estimated_total_sulfide_mmol` and a separate sampling-corrected total-sulfide inventory.

These reactive pools are separate from the molecular `total_bottle_mmol` result. Estimated DIC is strongly pH-dependent; for quantitative CO2 utilization/carbon balances, pH should preferably be measured at each time point.

Input QC stays quiet when nothing is wrong and reports **All good!**.
