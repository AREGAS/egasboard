# Browser-only v0.1 implementation

The public build contains no scientific server backend. All scientific functions are ordinary JavaScript modules under `js/` and mirror the Python reference implementation under `reference-python/`.

## Why retain Python?

The Python code is kept as a reference implementation, not as a deployment dependency. Numerical fixtures generated with the Python version are used by `tests/scientific-parity.mjs` to check that the browser calculation gives the same results within floating-point tolerance.

## Browser plotting

Interactive result and calibration plots remain SVG-based and are generated directly in the browser. They therefore remain fully interactive on static hosting.

## Excel plotting

The downloaded workbook is also generated in the browser. To avoid a fragile second implementation of Excel-native chart objects, v0.1 renders the same data as high-resolution PNG figures and embeds those figures into `Plots` and `Calibration_curves`.

Each sample receives:

- one all-gases plot of total bottle amount through time;
- one all-gases plot of headspace gas concentration through time.

Each calibration gas receives:

- observed calibration points;
- the fitted calibration line;
- fitted equation;
- R² where defined.

Numerical plot source data are not duplicated on the plot sheets. `Results` and `Calibration_data` remain the clear sources.
