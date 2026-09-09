# Changelog

## v0.1 - static browser architecture

- Ported the scientific calculation framework from the live Python backend to readable browser JavaScript modules.
- Retained the Python implementation under `reference-python/` as an clear reference and parity target.
- Added JavaScript/Python numerical parity tests for calibration, bottle calculations, speciation, salinity, gas dosing and example batch output.
- Moved Excel reading and workbook creation into the browser.
- Preserved interactive browser calibration and result plots.
- Added optional high-resolution PNG plots to downloaded Excel workbooks, with source numbers stored once in Results/Calibration_data.
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
