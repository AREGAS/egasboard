# Input and output format

## Measurement workbook

Use **one row for one bottle at one time point**.

Bottle conditions are written once in that row. Each measured gas gets its own
column, and the value in that gas column is the **GC peak area**.

Example:

| experiment_id | sample_id | time_h | pressure_bar_abs | temperature_C | bottle_volume_mL | liquid_volume_mL | CO | CO2 | CH4 |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| WK3_example | 1_CO | 3.63 | 1.583 | 23 | 120 | 39.56 | 829.1 | 274.4 | 2.4 |
| WK3_example | 1_CO | 16.17 | 1.545 | 23 | 120 | 39.06 | 408.2 | 455.3 | 7.5 |

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

### Gas columns

Use a recognized gas ID as the column header, for example:

`CO`, `CO2`, `CH4`, `O2`, `H2S`, `N2O`, `NO`, `N2`, `C2H6`

A blank gas cell simply means that gas was not measured at that time point.

Internally, the tool converts this wide table into individual gas observations
for calibration and calculation. You do not need to arrange the measurement
file that way yourself.

## Calibration workbook

Calibration stays in long format because every row is one calibration
observation:

| gas_id | calibration_id | gas_percent | peak_area |
|---|---|---:|---:|
| CO | CO_0 | 0 | 500 |
| CO | CO_10 | 10 | 100500 |
| CO2 | CO2_5 | 5 | 42000 |

Calibration replicates remain separate rows.

## Output

The main amount columns are:

- `total_bottle_mmol` - physical gas in the headspace + molecular dissolved gas
- `headspace_mmol`
- `molecular_dissolved_mmol`

`mmol` is an amount. Concentrations are labelled with their units.

If pH is supplied:

- CO2 can report `estimated_DIC_mmol` - dissolved CO2* + HCO3- + CO3^2-
- H2S can report `estimated_total_sulfide_mmol` - dissolved H2S + HS- + S2-

These reactive pools are separate from `total_bottle_mmol`.

Input QC stays quiet when nothing is wrong and reports **All good!**.
