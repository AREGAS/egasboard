
## 2026-09-24 - interactive rates, transfer sandbox and export cleanup

- Simplified the main Results table; detailed calculation/QC fields remain in Extended_data.
- Added linear rate fitting from selected Batch time-series intervals with signed rate and R².
- Added interactive Explore & predict mode for gas-transfer capacity versus kLa and headspace concentration.
- Saved rate/mass-transfer analyses now create an optional Rates_mass_transfer output table.
- Added Results-only or full ZIP package output for CSV/TSV.
- Split calibration output into Calibration_summary and Calibration_fits in Excel exports.
- Expanded gas-specific literature notes while keeping kLa and Henry-law values user-adjustable.
# Changelog

## v0.1 - post-release updates
- UI: added a second How it works flow for rate and gas-transfer screening.
- UI: slightly darkened table headers in light mode for clearer separation.

- Refined the rate/mass-transfer module with literature-based batch/shaken-vessel kLa notes, updated screening values, and direct CO batch context (Jang et al., 2017).
- Added user-overridable Henry Hcp and temperature-coefficient B values in the mass-transfer screen.
- Shortened the homepage introduction and added the rate/mass-transfer option to the main tool description.
- Added a separate **Rate & mass transfer** module for gas-uptake screening using `MTRmax = kLa × V_L × C*`.
- Added custom/measured kLa input plus rough vessel × rpm screening estimates for tubes, flasks, small bottles and larger bottles.
- Added central/low/high transfer-capacity outputs, transfer-demand ratio, minimum required kLa and transfer-risk warnings.
- Added explicit caveats that built-in kLa values are oxygen-based screening estimates and that 400 rpm values are higher-uncertainty extrapolations.
- Extended Gas dosing with equilibrated headspace targets in `%` or `ppmv`, while retaining dissolved concentration targets.
- Added `%`/`ppmv` conversion for initial headspace composition and dosing-mixture composition.
- Added final headspace concentration, final pressure and dissolved equilibrium outputs to Gas dosing.
- Renamed the Calculations tab to **How it works**, added a direct link from the landing text, and shortened the landing-page description.
- Added a short `%` versus `ppmv` nomenclature section to the calculation documentation.
- Added optional `liquid_sample_mL` and `headspace_sample_mL` columns for longitudinal sampling-loss correction.
- Added cumulative sampled amount and sampling-corrected bottle inventory while preserving the original measured bottle amount.
- Added pH-dependent sampling-corrected inorganic-carbon output for CO2 and total-sulfide output for H2S.
- Added sampling-corrected browser and Excel plots when sampling information is present.
- Expanded input templates, example data, calculation documentation and Excel reference output for the sampling convention.
- Added a stronger warning that estimated DIC is pH-sensitive in CO2 utilization/carbon-balance experiments.
- Standardized downloaded result filenames to `EGasboard_results_v0.1.*`.
- Reframed the README around the public `egasboard.org` tool and source-code transparency/reproducibility rather than self-hosting.

## v0.1 - static browser architecture

- Ported the scientific calculation framework from the live Python backend to readable browser JavaScript modules.
- Retained the Python implementation under `reference-python/` as an clear reference and parity target.
- Added JavaScript/Python numerical parity tests for calibration, bottle calculations, speciation, salinity, gas dosing and example batch output.
- Moved Excel reading and workbook creation into the browser.
- Preserved interactive browser calibration and result plots.
- Added optional high-resolution PNG plots to downloaded Excel workbooks, with source numbers stored once in the data sheets.
- Added GitHub Pages deployment workflow so pushes to `main` can update the public website automatically.

## v0.1 - HTML/Python web architecture

- Added compact header branding using the (E)Gasboard logo.
- Unified the light and dark themes around the dark-green identity.
- Simplified Metrics & citation to one Usage counter.
- Clarified automatic gas-column recognition.
- Straightened and compacted the calibration example table.

- Added wide-format browser and Excel results: one row per bottle/time point.
- Added a Calibration_curves Excel sheet with fitted calibration plots, equations and R².

- Refined light/dark visual identity.
- Added full-column two-row measurement and calibration examples.
- Rebuilt displayed equations with browser-native MathML.
- Reworked About into Metrics & citation with separate local counters.

- Rebuilt the user interface in plain HTML, CSS and JavaScript.
- Added a FastAPI Python backend.
- Kept the scientific Python calculation modules separate from presentation.
- Added Excel batch upload and downloadable Excel results.
- Added single-bottle calculations.
- Added inverse gas-dosing calculations.
- Added simple dependency-free SVG time-series plots with labelled axes and
  visible zero axes.
- Kept physical CO2 and estimated DIC as separate outputs.
- Added local browser calculation counter as a placeholder for future
  deployment-level usage metrics.

## Earlier prototype

Streamlit v0.3 was used for workflow development and colleague testing.


- Simplified the normal Results sheet and added Extended_data for full output.
- Combined metadata and gas properties on one worksheet.
- Added calibration plots to the browser batch results.
- Constrained negative multipoint calibration intercepts to zero and refitted slope.
- Restored the text header with the logo beside it.
- Centered the Excel download button and styled it as the main green action.
- Made Calculations and Metrics & citation panels use the full content width.

## v0.1 release preparation

- GitHub Pages static build
- GPL-3.0-or-later
- GoatCounter-ready analytics hooks
- local tool-use and gas-calculation counters
- corrected Excel template compatibility

### UI cleanup: dosing, rate/mass transfer and How it works

- regrouped Gas dosing inputs into clearer rows and shortened dosing labels;
- simplified Rate & mass transfer labels, controls and action buttons;
- replaced the two mass-transfer plots with one rate-vs-required-kLa plot;
- added an explanation below the plot and improved dark-mode chart contrast;
- moved the rate/mass-transfer equations into the same equation boxes used elsewhere;
- reduced the visible mass-transfer reference list to the core sources used for the screening model.

### UI cleanup: Batch-to-rate handoff and mass-transfer screen

- added a clear Batch-results prompt linking time-series data to rate fitting and the optional `Rates_mass_transfer` output;
- made the Batch-to-rate button open Rate & mass transfer directly in Batch time-series mode;
- shortened Rate & mass transfer labels, previews and assessment text;
- aligned the mass-transfer checkbox with the Mode and Rate source controls;
- kept a single rate-vs-required-kLa plot, moved it directly below the settings/actions, improved label spacing, and added a dark-red current-rate marker in dark mode;
- consolidated the mass-transfer literature into a short table in How it works and removed citations from the interactive controls;
- Explore & predict now counts once as a tool use on the first successful live calculation instead of counting every tweak.

- Rate & mass transfer now includes vessel volume so closed-bottle headspace volume, gas inventory and a simple inventory/rate depletion time can be reported.
