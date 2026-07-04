const STORAGE_KEY = "latestCapture";
const FIELD_NAMES = [
  "fontFamily",
  "renderedFontFamily",
  "fontOrigin",
  "fontSize",
  "lineHeight",
  "fontWeight",
  "fontStyle",
  "letterSpacing",
  "wordSpacing",
  "textTransform",
  "textDecoration",
  "color",
  "backgroundColor",
  "contrastRatio",
  "topSelector",
  "fontFamilySelector",
  "tagName",
  "element",
];
const CAPTURE_FIELD_NAMES = FIELD_NAMES.filter((fieldName) => fieldName !== "contrastRatio");
const DECLARED_RULE_NAMES = ["declaredFontSizeRule", "declaredLineHeightRule"];
const CSS_PROPERTY_BY_FIELD = {
  renderedFontFamily: "font-family",
  fontFamily: "font-family",
  fontSize: "font-size",
  fontWeight: "font-weight",
  fontStyle: "font-style",
  lineHeight: "line-height",
  letterSpacing: "letter-spacing",
  wordSpacing: "word-spacing",
  textTransform: "text-transform",
  textDecoration: "text-decoration",
  color: "color",
  backgroundColor: "background-color",
};
const COLOR_FIELDS = new Set(["color", "backgroundColor"]);
const SUMMARY_LIST_NAMES = [
  "uniqueFontFamilies",
  "commonSizes",
  "commonWeights",
  "headingPatterns",
  "bodyPatterns",
];

const inspectButton = document.querySelector("#inspect-button");
const copyButton = document.querySelector("#copy-button");
const statusOutput = document.querySelector("#status");
const emptyState = document.querySelector("#empty-state");
const resultList = document.querySelector("#result-list");
const summaryCard = document.querySelector("#summary-card");
const summaryCount = document.querySelector("[data-summary-count]");
const fieldOutputs = new Map(
  Array.from(document.querySelectorAll("[data-field]"), (element) => [element.dataset.field, element]),
);
const ruleOutputs = new Map(
  Array.from(document.querySelectorAll("[data-rule-field]"), (element) => [element.dataset.ruleField, element]),
);
const declaredRuleOutputs = new Map(
  Array.from(document.querySelectorAll("[data-declared-rule-field]"), (element) => [element.dataset.declaredRuleField, element]),
);
const summaryLists = new Map(
  Array.from(document.querySelectorAll("[data-summary-list]"), (element) => [element.dataset.summaryList, element]),
);

let latestCapture = null;

inspectButton.addEventListener("click", () => {
  void startInspection();
});

copyButton.addEventListener("click", () => {
  void copyLatestCapture();
});

for (const [fieldName, button] of fieldOutputs) {
  button.addEventListener("click", () => {
    void copyField(fieldName);
  });
}

for (const [fieldName, button] of ruleOutputs) {
  button.addEventListener("click", () => {
    void copyRule(fieldName);
  });
}

for (const [fieldName, button] of declaredRuleOutputs) {
  button.addEventListener("click", () => {
    void copyDeclaredRule(fieldName);
  });
}

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
    window.close();
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

async function copyField(fieldName) {
  if (!latestCapture || typeof latestCapture[fieldName] !== "string") {
    return;
  }

  try {
    await navigator.clipboard.writeText(latestCapture[fieldName]);
    setStatus(`${getFieldLabel(fieldName)} copied.`);
  } catch (error) {
    console.warn("Could not copy typography field.", error);
    setStatus("Could not copy that field.");
  }
}

async function copyRule(fieldName) {
  const rule = getCssRule(fieldName);

  if (!rule) {
    return;
  }

  try {
    await navigator.clipboard.writeText(rule);
    setStatus(`${getFieldLabel(fieldName)} CSS rule copied.`);
  } catch (error) {
    console.warn("Could not copy typography CSS rule.", error);
    setStatus("Could not copy that CSS rule.");
  }
}

async function copyDeclaredRule(fieldName) {
  if (!latestCapture || typeof latestCapture[fieldName] !== "string" || !latestCapture[fieldName]) {
    return;
  }

  try {
    await navigator.clipboard.writeText(latestCapture[fieldName]);
    setStatus(`${getFieldLabel(fieldName)} copied.`);
  } catch (error) {
    console.warn("Could not copy declared CSS rule.", error);
    setStatus("Could not copy that declared rule.");
  }
}

function renderCapture(capture) {
  if (!isCapture(capture)) {
    latestCapture = null;
    emptyState.hidden = false;
    resultList.hidden = true;
    summaryCard.hidden = true;
    for (const button of fieldOutputs.values()) {
      button.textContent = "--";
      button.disabled = true;
      button.removeAttribute("title");
    }
    for (const button of ruleOutputs.values()) {
      button.disabled = true;
      button.removeAttribute("title");
    }
    for (const button of declaredRuleOutputs.values()) {
      button.disabled = true;
      button.removeAttribute("title");
    }
    copyButton.disabled = true;
    return;
  }

  latestCapture = capture;
  capture.contrastRatio = getContrastText(capture.color, capture.backgroundColor);

  for (const fieldName of FIELD_NAMES) {
    const output = fieldOutputs.get(fieldName);

    if (output) {
      const value = capture[fieldName] || "--";
      renderFieldValue(output, fieldName, value);
      output.title = `Copy ${getFieldLabel(fieldName)}: ${value}`;
      output.disabled = !capture[fieldName];
    }

    const ruleOutput = ruleOutputs.get(fieldName);

    if (ruleOutput) {
      const rule = getCssRule(fieldName, capture);
      ruleOutput.disabled = !rule;
      ruleOutput.title = rule ? `Copy ${rule}` : "No CSS rule available";
    }
  }

  for (const fieldName of DECLARED_RULE_NAMES) {
    const output = declaredRuleOutputs.get(fieldName);
    const value = capture[fieldName];

    if (output) {
      output.disabled = !value;
      output.title = value ? `Copy ${value}` : "No declared rule available";
    }
  }

  emptyState.hidden = true;
  resultList.hidden = false;
  renderPageSummary(capture.pageSummary);
  copyButton.disabled = false;
}

function renderPageSummary(summary) {
  if (!isPageSummary(summary)) {
    summaryCard.hidden = true;
    return;
  }

  summaryCard.hidden = false;
  summaryCount.textContent = summary.scannedVisibleTextElements || "0";

  for (const listName of SUMMARY_LIST_NAMES) {
    renderEntryList(summaryLists.get(listName), summary[listName]);
  }

}

function renderEntryList(list, entries) {
  if (!list) {
    return;
  }

  list.replaceChildren(...normalizeEntries(entries).map(createEntryItem));

  if (!list.childElementCount) {
    const item = document.createElement("li");
    item.textContent = "No repeated pattern detected";
    list.append(item);
  }
}

function createEntryItem(entry) {
  const item = document.createElement("li");
  item.textContent = `${entry.value} (${entry.count})`;

  return item;
}

function formatCapture(capture) {
  const detailLines = [
    `Declared font-family: ${capture.fontFamily || "--"}`,
    `Rendered font: ${capture.renderedFontFamily || "--"}`,
    `Font origin: ${capture.fontOrigin || "--"}`,
    `Size: ${capture.fontSize || "--"}`,
    `Declared size rule: ${capture.declaredFontSizeRule || "--"}`,
    `Line height: ${capture.lineHeight || "--"}`,
    `Declared line-height rule: ${capture.declaredLineHeightRule || "--"}`,
    `Weight: ${capture.fontWeight || "--"}`,
    `Style: ${capture.fontStyle || "--"}`,
    `Letter spacing: ${capture.letterSpacing || "--"}`,
    `Word spacing: ${capture.wordSpacing || "--"}`,
    `Text transform: ${capture.textTransform || "--"}`,
    `Text decoration: ${capture.textDecoration || "--"}`,
    `Color: ${capture.color || "--"}`,
    `Background: ${capture.backgroundColor || "--"}`,
    `Contrast: ${capture.contrastRatio || getContrastText(capture.color, capture.backgroundColor) || "--"}`,
    `Top selector: ${capture.topSelector || "--"}`,
    `Font-family selector: ${capture.fontFamilySelector || "--"}`,
    `Tag: ${capture.tagName || "--"}`,
    `Element: ${capture.element || "--"}`,
  ];
  const summary = capture.pageSummary;

  if (!isPageSummary(summary)) {
    return detailLines.join("\n");
  }

  return [
    ...detailLines,
    "",
    `Visible elements scanned: ${summary.scannedVisibleTextElements}`,
    `Font families: ${formatEntries(summary.uniqueFontFamilies)}`,
    `Common sizes: ${formatEntries(summary.commonSizes)}`,
    `Common weights: ${formatEntries(summary.commonWeights)}`,
    `Heading patterns: ${formatEntries(summary.headingPatterns)}`,
    `Body patterns: ${formatEntries(summary.bodyPatterns)}`,
  ].join("\n");
}

function renderFieldValue(output, fieldName, value) {
  output.replaceChildren();

  if (COLOR_FIELDS.has(fieldName)) {
    const swatch = document.createElement("span");
    const label = document.createElement("span");

    swatch.className = "color-swatch";
    swatch.style.backgroundColor = value;
    label.textContent = value;
    output.append(swatch, label);
    return;
  }

  output.textContent = value;
}

function setStatus(message) {
  statusOutput.textContent = message;
}

function getFieldLabel(fieldName) {
  return fieldName
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (character) => character.toUpperCase());
}

function getCssRule(fieldName, capture = latestCapture) {
  if (!capture || typeof capture[fieldName] !== "string") {
    return "";
  }

  const cssProperty = CSS_PROPERTY_BY_FIELD[fieldName];

  if (!cssProperty) {
    return "";
  }

  return `${cssProperty}: ${capture[fieldName]};`;
}

function getContrastText(foreground, background) {
  const foregroundRgb = parseRgbColor(foreground);
  const backgroundRgb = parseRgbColor(background);

  if (!foregroundRgb || !backgroundRgb) {
    return "Unavailable";
  }

  const ratio = getContrastRatio(foregroundRgb, backgroundRgb);
  const aaNormal = ratio >= 4.5 ? "AA normal pass" : "AA normal fail";
  const aaLarge = ratio >= 3 ? "AA large pass" : "AA large fail";

  return `${ratio.toFixed(2)}:1 (${aaNormal}, ${aaLarge})`;
}

function parseRgbColor(value) {
  const match = /^rgba?\(([^)]+)\)$/.exec(value || "");

  if (!match) {
    return null;
  }

  const parts = match[1].split(",").map((part) => Number.parseFloat(part.trim()));

  if (parts.length < 3 || parts.slice(0, 3).some((part) => Number.isNaN(part))) {
    return null;
  }

  return parts.slice(0, 3).map((part) => Math.min(Math.max(part, 0), 255));
}

function getContrastRatio(foreground, background) {
  const lighter = Math.max(getRelativeLuminance(foreground), getRelativeLuminance(background));
  const darker = Math.min(getRelativeLuminance(foreground), getRelativeLuminance(background));

  return (lighter + 0.05) / (darker + 0.05);
}

function getRelativeLuminance(rgb) {
  const [red, green, blue] = rgb.map((channel) => {
    const normalized = channel / 255;

    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function isInspectableUrl(url) {
  return typeof url === "string" && /^(https?|file):/.test(url);
}

function isCapture(value) {
  return value !== null
    && typeof value === "object"
    && CAPTURE_FIELD_NAMES.every((fieldName) => typeof value[fieldName] === "string")
    && DECLARED_RULE_NAMES.every((fieldName) => typeof value[fieldName] === "string")
    && isPageSummary(value.pageSummary);
}

function isPageSummary(value) {
  return value !== null
    && typeof value === "object"
    && typeof value.scannedVisibleTextElements === "string"
    && SUMMARY_LIST_NAMES.every((fieldName) => Array.isArray(value[fieldName]));
}

function normalizeEntries(entries) {
  return Array.isArray(entries)
    ? entries.filter((entry) => (
      entry !== null
      && typeof entry === "object"
      && typeof entry.value === "string"
      && Number.isInteger(entry.count)
    ))
    : [];
}

function formatEntries(entries) {
  const values = normalizeEntries(entries).map((entry) => `${entry.value} (${entry.count})`);

  return values.length ? values.join(", ") : "none";
}
