const STORAGE_KEY = "latestCapture";
const FIELD_NAMES = [
  "renderedFontFamily",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "fontStyle",
  "color",
  "backgroundColor",
  "element",
];

const inspectButton = document.querySelector("#inspect-button");
const copyButton = document.querySelector("#copy-button");
const statusOutput = document.querySelector("#status");
const emptyState = document.querySelector("#empty-state");
const resultList = document.querySelector("#result-list");
const fieldOutputs = new Map(
  Array.from(document.querySelectorAll("[data-field]"), (element) => [element.dataset.field, element]),
);

let latestCapture = null;

inspectButton.addEventListener("click", () => {
  void startInspection();
});

copyButton.addEventListener("click", () => {
  void copyLatestCapture();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[STORAGE_KEY]) {
    return;
  }

  renderCapture(changes[STORAGE_KEY].newValue);
  setStatus("Typography captured. Data stayed local to this browser.");
});

void restoreLatestCapture();

async function startInspection() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id || !isInspectableUrl(tab.url)) {
    setStatus("Open a regular web page before starting inspection.");
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content-inspector.js"],
    });
    await chrome.tabs.sendMessage(tab.id, { type: "type-inspector:start" });
    await chrome.action.setBadgeText({ tabId: tab.id, text: "ON" });
    await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#059669" });
    setStatus("Inspection is active. Click text on the page, or press Escape to cancel.");
  } catch (error) {
    console.warn("Could not start Type Inspector.", error);
    setStatus("Could not start inspection on this page.");
  }
}

async function restoreLatestCapture() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  renderCapture(stored[STORAGE_KEY]);
}

async function copyLatestCapture() {
  if (!latestCapture) {
    return;
  }

  try {
    await navigator.clipboard.writeText(formatCapture(latestCapture));
    setStatus("Typography summary copied.");
  } catch (error) {
    console.warn("Could not copy typography summary.", error);
    setStatus("Could not copy typography summary.");
  }
}

function renderCapture(capture) {
  if (!isCapture(capture)) {
    latestCapture = null;
    emptyState.hidden = false;
    resultList.hidden = true;
    copyButton.disabled = true;
    return;
  }

  latestCapture = capture;

  for (const fieldName of FIELD_NAMES) {
    const output = fieldOutputs.get(fieldName);

    if (output) {
      output.textContent = capture[fieldName] || "--";
    }
  }

  emptyState.hidden = true;
  resultList.hidden = false;
  copyButton.disabled = false;
}

function formatCapture(capture) {
  return [
    `Rendered font: ${capture.renderedFontFamily || "--"}`,
    `Font stack: ${capture.fontFamily || "--"}`,
    `Size: ${capture.fontSize || "--"}`,
    `Weight: ${capture.fontWeight || "--"}`,
    `Line height: ${capture.lineHeight || "--"}`,
    `Letter spacing: ${capture.letterSpacing || "--"}`,
    `Style: ${capture.fontStyle || "--"}`,
    `Color: ${capture.color || "--"}`,
    `Background: ${capture.backgroundColor || "--"}`,
    `Element: ${capture.element || "--"}`,
  ].join("\n");
}

function setStatus(message) {
  statusOutput.textContent = message;
}

function isInspectableUrl(url) {
  return typeof url === "string" && /^(https?|file):/.test(url);
}

function isCapture(value) {
  return value !== null
    && typeof value === "object"
    && FIELD_NAMES.every((fieldName) => typeof value[fieldName] === "string");
}
