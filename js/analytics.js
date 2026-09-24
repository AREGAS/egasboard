import {GOATCOUNTER_ENDPOINT} from "./analytics-config.js";

let analyticsReady = false;
let analyticsStarted = false;
const pendingEvents = [];

// Every event in this list also increments the public /calculation-total counter.
const calculationEvents = [
  "batch-calculation",
  "single-calculation",
  "gas-dosing",
  "mass-transfer-analysis"
];

/*
Only event names and short titles are sent.
Uploaded files, sample identifiers and calculation values are never sent.
*/
function analyticsIsConfigured() {
  return typeof GOATCOUNTER_ENDPOINT === "string" &&
         GOATCOUNTER_ENDPOINT.trim() !== "";
}

function sendCalculationTotal() {
  window.goatcounter.count({
    path: "/calculation-total",
    title: "Calculation total",
    no_session: true
  });
}

function sendEvent(event) {
  if (!analyticsReady ||
      !window.goatcounter ||
      typeof window.goatcounter.count !== "function") {
    pendingEvents.push(event);
    return;
  }

  window.goatcounter.count({
    path: event.path,
    title: event.title,
    event: true,
    no_session: true
  });

  if (calculationEvents.includes(event.path)) {
    sendCalculationTotal();
  }
}

function flushPendingEvents() {
  while (pendingEvents.length > 0) {
    const event = pendingEvents.shift();

    window.goatcounter.count({
      path: event.path,
      title: event.title,
      event: true,
      no_session: true
    });

    if (calculationEvents.includes(event.path)) {
      sendCalculationTotal();
    }
  }
}

export function initializeAnalytics() {
  if (analyticsStarted || !analyticsIsConfigured()) {
    return;
  }

  analyticsStarted = true;

  const script = document.createElement("script");
  script.async = true;
  script.src = "https://gc.zgo.at/count.js";

  script.setAttribute(
    "data-goatcounter",
    GOATCOUNTER_ENDPOINT.trim()
  );

  script.setAttribute(
    "data-goatcounter-settings",
    JSON.stringify({no_onload: true})
  );

  script.addEventListener("load", () => {
    if (!window.goatcounter ||
        typeof window.goatcounter.count !== "function") {
      return;
    }

    analyticsReady = true;

    window.goatcounter.count({
      path: window.location.pathname || "/",
      title: document.title
    });

    flushPendingEvents();
  });

  document.head.appendChild(script);
}

export function trackAnalyticsEvent(path, title) {
  if (!analyticsIsConfigured()) {
    return;
  }

  sendEvent({
    path: path,
    title: title || path
  });
}

export function setupTrackedLinks() {
  document.querySelectorAll("[data-track-event]").forEach(element => {
    element.addEventListener("click", () => {
      trackAnalyticsEvent(
        element.dataset.trackEvent,
        element.dataset.trackTitle || element.textContent.trim()
      );
    });
  });
}

export async function getGlobalCalculationCount() {
  try {
    const path = "/calculation-total";

    const url =
      "https://raegas.goatcounter.com/counter/" +
      encodeURIComponent(path) +
      ".json";

    const response = await fetch(url);

    if (!response.ok) {
      return 0;
    }

    const data = await response.json();

    const count = Number(
      String(data.count).replaceAll(",", "")
    );

    if (Number.isFinite(count)) {
      return count;
    }
  } catch (error) {
    console.warn(
      "Could not retrieve GoatCounter calculation count"
    );
  }

  return 0;
}
