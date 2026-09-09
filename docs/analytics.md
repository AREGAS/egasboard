# GoatCounter

GoatCounter is optional. The calculator works without it.

## Setup

1. Put the website online.
2. Create the GoatCounter site.
3. Copy the full `/count` endpoint.
4. Open `js/analytics-config.js`.
5. Paste the endpoint into `GOATCOUNTER_ENDPOINT`.
6. Commit and push.

Example:

```javascript
export const GOATCOUNTER_ENDPOINT =
  "https://egasboard.goatcounter.com/count";
```

## Tracked events

- `batch-calculation`
- `single-calculation`
- `gas-dosing`
- `excel-results-download`
- `measurement-template-download`
- `calibration-template-download`
- `example-measurements-download`
- `example-calibration-download`
- `bluesky-link`

The batch event title includes the number of gas observations in that batch.

Uploaded files, sample identifiers and calculation values are not sent.
