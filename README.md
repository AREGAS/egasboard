<p align="center">
  <img src="./assets/egasboard-logo.png" alt="(E)Gasboard logo" width="420">
</p>

<h1 align="center">(E)Gasboard v0.1 </h1>

<p align="center">
  Gas calculations for closed incubations and microcosms.
</p>

The public site is **static**: calculations run in the browser. No Python server is needed and uploaded Excel files stay on the user's computer.

## What it does

- converts GC peak areas to gas percentages using gas-specific calibration curves;
- calculates gas partial pressure from gas fraction and absolute bottle pressure;
- calculates headspace gas from the gas law;
- calculates dissolved gas using Henry's law with temperature correction;
- optionally applies a NaCl / NaCl-equivalent salting-out correction;
- optionally estimates pH-dependent CO2 and H2S dissolved speciation;
- calculates total bottle gas amount;
- calculates gas additions required to reach a target dissolved concentration;
- processes wide-format Excel batch files;
- produces interactive calibration and time-series plots in the browser;
- exports a formatted Excel workbook with Results, Extended_data, plots, calibration data and a calculation Reference sheet.

## Static architecture

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
  +-- Excel input/output in the browser
  |     excel-io.js
  |
  +-- interactive SVG plots
        app.js
```

There is no FastAPI backend in the public build. The previous Python implementation is retained under `reference-python/` as the reference implementation for parity tests.

## Excel output

The static browser build exports:

1. `Results`
2. `Extended_data`
3. `Plots` - optional PNG plots
4. `Calibration_data`
5. `Calibration_curves` - optional PNG plots
6. `Reference`

Plot sheets contain images only. Source values stay in the data sheets.

Excel file parsing and workbook generation use ExcelJS in the browser. The current site loads ExcelJS 4.4.0 from jsDelivr. Scientific calculations do not depend on ExcelJS.

## Run locally

Because the site uses JavaScript modules, serve the folder through a small local web server rather than opening `index.html` directly with `file://`.

If Python is available:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

This local server is only for development/testing. The public application itself does not require Python hosting.

## GitHub Pages deployment

The repository includes `.github/workflows/pages.yml`.

After creating the GitHub repository:

1. push the files to the `main` branch;
2. open **Settings -> Pages**;
3. set the source to **GitHub Actions**;
4. the included workflow deploys the repository as a static website;
5. subsequent pushes to `main` automatically update the live site.

A custom domain such as `egasboard.org` can then be configured in GitHub Pages and at the domain registrar.

## Analytics

The public site can use GoatCounter for simple usage statistics.

Configuration is in:

```text
js/analytics-config.js
```

Paste the GoatCounter `/count` endpoint into `GOATCOUNTER_ENDPOINT`.

The site tracks page views and successful batch, single, dosing and download actions. Uploaded Excel files, sample identifiers and calculation values are not sent to GoatCounter.

The counters shown in Metrics & citation are stored in the visitor's browser.

## Scientific code

The scientific code is split into small modules with equations, units and comments kept visible.

The JavaScript implementation is tested against numerical fixtures generated from the Python reference implementation:

```bash
npm test
```

The parity suite covers calibration, the negative-intercept constraint, single gas states, CO2 speciation, salting-out correction, gas dosing and the example batch dataset.

## Core assumptions

- one measurement row represents one closed bottle at one time point;
- entered pressure is absolute;
- water vapour is neglected in v0.1; a correction is planned for a later version;
- v0.1 uses the ideal gas law with `Z = 1`;
- Henry constants use the `Hcp = c/p` convention;
- salting out uses NaCl-equivalent concentration;
- total bottle amount is headspace + molecular dissolved gas; estimated DIC and estimated dissolved total sulfide are separate.

Detailed equations and assumptions are available in the **Calculations** tab and under `docs/`.

## Citation

Preferred citation after the v0.1 release is archived in Zenodo:

> Egas, R. A. (2026). (E)Gasboard (v0.1) [Computer software]. Zenodo. DOI pending.

The permanent Zenodo DOI will be inserted here after release.

## License

(E)Gasboard is released under GPL-3.0-or-later. See `LICENSE`.

