<p align="center">
  <img src="./assets/egasboard-logo.png" alt="(E)Gasboard logo" width="420">
</p>

<p align="center">
  <a href="https://doi.org/10.5281/zenodo.22704550">
    <img
      src="https://zenodo.org/badge/DOI/10.5281/zenodo.22704550.svg"
      alt="DOI"
    >
  </a>
</p>

<p align="center">
  <a href="https://egasboard.org">
    <strong>Open (E)Gasboard</strong>
  </a>
</p>

<h1 align="center">(E)Gasboard v0.1</h1>

<p align="center">
  Gas calculations for closed incubations and microcosms.
</p>

## Use the tool

The intended user interface is the public website:

**https://egasboard.org**

Calculations run locally in the browser. Uploaded measurement/calibration files and calculated results are not sent to an (E)Gasboard server.

This GitHub repository is primarily provided for **transparency, reproducibility, versioning and inspection of the scientific code**. Most users do not need to download, install or host the website themselves.

## What it does

- converts GC peak areas to gas percentages using gas-specific calibration curves;
- calculates gas partial pressure from gas fraction and absolute bottle pressure;
- calculates headspace gas from the gas law;
- calculates molecular dissolved gas using Henry's law with temperature correction;
- optionally applies a NaCl / NaCl-equivalent salting-out correction;
- optionally estimates pH-dependent CO2/DIC and H2S/sulfide pools;
- calculates total bottle gas amount;
- optionally corrects longitudinal batch data for gas and liquid removed during repeated sampling;
- keeps the measured bottle inventory and sampling-corrected inventory as separate outputs;
- calculates gas additions required to reach a target dissolved concentration;
- accepts `.xlsx`, `.csv` and `.tsv` batch input;
- produces interactive calibration and time-series plots in the browser;
- exports formatted Excel results and simpler CSV/TSV results.

For CO2 carbon-balance work, estimated DIC is intentionally kept separate from physical CO2. DIC is strongly pH-dependent, so time-resolved pH measurements are recommended when quantitative DIC or sampling-corrected inorganic-carbon balances are required.

## Sampling-loss correction

Batch measurement files can optionally contain:

```text
liquid_sample_mL
headspace_sample_mL
```

The volumes on a row are interpreted as material removed **after the measurement on that row**. They therefore affect only subsequent sampling-corrected time points.

The original `total_bottle_mmol` is never overwritten. When sampling information is supplied, (E)Gasboard additionally reports a cumulative sampling loss and `sampling_corrected_total_mmol`.

For CO2 and H2S, pH-dependent sampling-corrected reactive-pool balances are also calculated when pH is available.

The entered `liquid_volume_mL` must always be the actual liquid volume present at that measurement. (E)Gasboard does not automatically subtract the liquid sample volume from later rows.

## Output

The Excel export is named, for example:

```text
EGasboard_results_v0.1.xlsx
```

and contains:

1. `Results` - concise bottle/time-point output;
2. `Extended_data` - detailed gas-specific calculation output;
3. `Plots` - optional PNG time-series plots, including sampling-corrected plots when applicable;
4. `Calibration_data`;
5. `Calibration_curves` - optional PNG calibration plots;
6. `Reference` - calculation and output conventions.

CSV/TSV output currently contains the main Results table. Extended CSV/TSV parity is planned as a small follow-up update.

## Scientific architecture

```text
browser
  |
  +-- index.html + style.css
  |
  +-- readable JavaScript scientific modules
  |     calibration.js
  |     calculations.js
  |     gas-properties.js
  |     salinity.js
  |     speciation.js
  |     batch-processing.js
  |
  +-- browser table input/output
  |     excel-io.js
  |
  +-- interactive SVG plots
        app.js
```

The public site is static; there is no calculation backend. The earlier Python calculation implementation is retained under `reference-python/` as a readable reference implementation and parity target.

## Source code and reproducibility

The scientific code is intentionally split into small modules so equations, units and assumptions remain inspectable.

The JavaScript implementation can be checked against numerical fixtures generated from the Python reference implementation with:

```bash
npm test
```

The parity suite covers calibration, bottle calculations, CO2 speciation, salting-out correction, gas dosing and batch processing. Sampling-loss calculations are additionally tested in the batch-processing tests.

For local inspection/development only, the repository can be served with a simple static server, for example:

```bash
python -m http.server 8000
```

and opened at `http://localhost:8000`. This is not required to use (E)Gasboard; normal users should use **egasboard.org**.

## Core assumptions

- one measurement row represents one closed bottle at one time point;
- entered pressure is absolute;
- water vapour is neglected in v0.1;
- v0.1 uses the ideal gas law with `Z = 1`;
- Henry constants use the `Hcp = c/p` convention;
- salting out uses NaCl-equivalent concentration;
- total bottle amount is headspace + molecular dissolved gas;
- estimated DIC and estimated dissolved total sulfide are separate outputs;
- optional sampling volumes are removed after the measurement on their row;
- sampling-corrected values are mass-balance inventories, not predictions of the exact concentration in an unsampled bottle.

Detailed equations and assumptions are available in the **Calculations** tab and under `docs/`.

## Analytics

The public site uses GoatCounter for simple usage statistics. Uploaded files, sample identifiers and calculation values are not sent to GoatCounter.

Configuration is in:

```text
js/analytics-config.js
```

## Citation

> Egas, R. A. (2026). *(E)Gasboard* (v0.1) [Computer software]. Zenodo. https://doi.org/10.5281/zenodo.22704550

## License

(E)Gasboard is released under GPL-3.0-or-later. See `LICENSE`.
