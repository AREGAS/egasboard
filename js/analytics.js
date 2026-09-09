import {GOATCOUNTER_ENDPOINT} from "./analytics-config.js";

let analyticsReady = false;
let analyticsStarted = false;
const pendingEvents = [];

/*
Only event names and short titles are sent.
Uploaded files, sample identifiers and calculation values are never sent.
*/
function analyticsIsConfigured() {
  return typeof GOATCOUNTER_ENDPOINT === "string" &&
         GOATCOUNTER_ENDPOINT.trim() !== "";
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
    event: true
  });
}

function flushPendingEvents() {
  while (pendingEvents.length > 0) {
    const event = pendingEvents.shift();

    window.goatcounter.count({
      path: event.path,
      title: event.title,
      event: true
    });
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
