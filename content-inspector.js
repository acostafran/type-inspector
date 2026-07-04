(() => {
  if (window.__typeInspectorLoaded) {
    return;
  }

  window.__typeInspectorLoaded = true;

  const OVERLAY_ID = "type-inspector-overlay";
  const STYLE_ID = "type-inspector-style";
  const TEXT_ELEMENT_SELECTOR = "strong, em, b, i, mark, small, sub, sup, cite, q, abbr, time, code, samp, kbd, var, span, a, button, label, li, h1, h2, h3, h4, h5, h6, p, blockquote, figcaption, th, td, dt, dd, pre";
  const MAX_SUMMARY_ELEMENTS = 350;
  const COMMON_SYSTEM_FONTS = new Set([
    "-apple-system",
    "blinkmacsystemfont",
    "system-ui",
    "ui-sans-serif",
    "ui-serif",
    "ui-monospace",
    "arial",
    "avenir",
    "calibri",
    "cambria",
    "courier new",
    "georgia",
    "helvetica",
    "helvetica neue",
    "menlo",
    "monaco",
    "roboto",
    "segoe ui",
    "sf pro display",
    "sf pro text",
    "times new roman",
    "verdana",
  ]);
  let overlay = null;
  let active = false;
  let highlightedElement = null;

  chrome.runtime.onMessage.addListener((message) => {
    if (!isRecord(message) || message.type !== "type-inspector:start") {
      return false;
    }

    startInspection();
    return false;
  });

  function startInspection() {
    if (active) {
      return;
    }

    active = true;
    ensureStyle();
    ensureOverlay();
    document.addEventListener("mousemove", handleMouseMove, true);
    document.addEventListener("click", handleClick, true);
    document.addEventListener("keydown", handleKeyDown, true);
  }

  function stopInspection() {
    if (!active) {
      return;
    }

    active = false;
    highlightedElement = null;
    document.removeEventListener("mousemove", handleMouseMove, true);
    document.removeEventListener("click", handleClick, true);
    document.removeEventListener("keydown", handleKeyDown, true);
    overlay?.remove();
    overlay = null;
    chrome.runtime.sendMessage({ type: "type-inspector:ended" });
  }

  function handleMouseMove(event) {
    const candidate = getInspectableElement(event);

    if (!candidate || candidate === highlightedElement) {
      return;
    }

    highlightedElement = candidate;
    updateOverlay(candidate);
  }

  function handleClick(event) {
    const candidate = getInspectableElement(event);

    if (!candidate) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    chrome.runtime.sendMessage({
      type: "type-inspector:capture",
      payload: captureTypography(candidate),
    });
    stopInspection();
  }

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      stopInspection();
    }
  }

  function getInspectableElement(event) {
    const target = getTargetFromPoint(event) ?? getComposedPathElement(event);

    if (!(target instanceof Element) || target.id === OVERLAY_ID || target.closest(`#${OVERLAY_ID}`)) {
      return null;
    }

    const element = getDeepestTextElement(target) ?? target.closest(TEXT_ELEMENT_SELECTOR) ?? target;
    const text = element.textContent?.trim();

    return text ? element : null;
  }

  function getTargetFromPoint(event) {
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
      return null;
    }

    return document.elementFromPoint(event.clientX, event.clientY);
  }

  function getComposedPathElement(event) {
    return event.composedPath?.().find((entry) => entry instanceof Element) ?? null;
  }

  function getDeepestTextElement(root) {
    const matches = Array.from(root.querySelectorAll?.(TEXT_ELEMENT_SELECTOR) ?? [])
      .filter((element) => element.textContent?.trim() && isVisibleElement(element));

    return matches.at(-1) ?? (root.matches?.(TEXT_ELEMENT_SELECTOR) ? root : null);
  }

  function captureTypography(element) {
    const styles = window.getComputedStyle(element);
    const families = splitFontFamilies(styles.fontFamily);
    const renderedFontFamily = getRenderedFontFamily(element, families) || "Unknown";

    return {
      renderedFontFamily,
      fontFamily: styles.fontFamily,
      fontSize: styles.fontSize,
      fontWeight: styles.fontWeight,
      fontStyle: styles.fontStyle,
      lineHeight: styles.lineHeight,
      letterSpacing: styles.letterSpacing,
      wordSpacing: styles.wordSpacing,
      textTransform: styles.textTransform,
      textDecoration: styles.textDecorationLine,
      color: styles.color,
      backgroundColor: getVisibleBackgroundColor(element),
      tagName: element.tagName.toLowerCase(),
      element: describeElement(element),
      styleSource: getStyleSource(element),
      fontOrigin: getFontOrigin(renderedFontFamily, families),
      pageSummary: capturePageSummary(),
      capturedAt: new Date().toISOString(),
    };
  }

  function capturePageSummary() {
    const summaryElements = getVisibleTextElements().slice(0, MAX_SUMMARY_ELEMENTS);
    const families = new Map();
    const sizes = new Map();
    const weights = new Map();
    const headingStyles = new Map();
    const bodyStyles = new Map();
    const tokenValues = {
      fontSizes: new Map(),
      lineHeights: new Map(),
      letterSpacings: new Map(),
      colors: new Map(),
    };

    for (const element of summaryElements) {
      const styles = window.getComputedStyle(element);
      const familyList = splitFontFamilies(styles.fontFamily);
      const primaryFamily = familyList[0] ?? styles.fontFamily;
      const pattern = `${styles.fontFamily} / ${styles.fontSize} / ${styles.fontWeight} / ${styles.lineHeight}`;

      increment(families, primaryFamily || "Unknown");
      increment(sizes, styles.fontSize);
      increment(weights, styles.fontWeight);
      increment(isHeadingElement(element) ? headingStyles : bodyStyles, pattern);
      increment(tokenValues.fontSizes, styles.fontSize);
      increment(tokenValues.lineHeights, styles.lineHeight);
      increment(tokenValues.letterSpacings, styles.letterSpacing);
      increment(tokenValues.colors, styles.color);
    }

    return {
      scannedVisibleTextElements: String(summaryElements.length),
      uniqueFontFamilies: topEntries(families, 12),
      commonSizes: topEntries(sizes, 10),
      commonWeights: topEntries(weights, 10),
      headingPatterns: topEntries(headingStyles, 6),
      bodyPatterns: topEntries(bodyStyles, 6),
      possibleDesignTokens: {
        fontSizes: repeatedEntries(tokenValues.fontSizes, 12),
        lineHeights: repeatedEntries(tokenValues.lineHeights, 10),
        letterSpacings: repeatedEntries(tokenValues.letterSpacings, 8),
        colors: repeatedEntries(tokenValues.colors, 12),
      },
    };
  }

  function getVisibleTextElements() {
    return Array.from(document.querySelectorAll(TEXT_ELEMENT_SELECTOR)).filter((element) => {
      const text = element.textContent?.trim();

      if (!text) {
        return false;
      }

      return isVisibleElement(element);
    });
  }

  function isVisibleElement(element) {
    const rect = element.getBoundingClientRect();
    const styles = window.getComputedStyle(element);

    return rect.width > 0
      && rect.height > 0
      && rect.bottom >= 0
      && rect.right >= 0
      && rect.top <= window.innerHeight
      && rect.left <= window.innerWidth
      && styles.visibility !== "hidden"
      && styles.display !== "none";
  }

  function getRenderedFontFamily(element, families = splitFontFamilies(window.getComputedStyle(element).fontFamily)) {
    if (!document.fonts?.check) {
      return families[0] ?? "";
    }

    const styles = window.getComputedStyle(element);
    const fontSize = styles.fontSize || "16px";

    return families.find((family) => document.fonts.check(`${fontSize} ${quoteFontFamily(family)}`)) ?? families[0] ?? "";
  }

  function splitFontFamilies(fontFamily) {
    return fontFamily
      .split(",")
      .map((family) => family.trim().replace(/^['\"]|['\"]$/g, ""))
      .filter(Boolean);
  }

  function quoteFontFamily(fontFamily) {
    return /^[a-z-]+$/i.test(fontFamily) ? fontFamily : JSON.stringify(fontFamily);
  }

  function getVisibleBackgroundColor(element) {
    let current = element;

    while (current) {
      const backgroundColor = window.getComputedStyle(current).backgroundColor;

      if (backgroundColor && backgroundColor !== "rgba(0, 0, 0, 0)" && backgroundColor !== "transparent") {
        return backgroundColor;
      }

      current = current.parentElement;
    }

    return window.getComputedStyle(document.documentElement).backgroundColor || "transparent";
  }

  function getStyleSource(element) {
    const matches = [];
    const inlineStyle = element.getAttribute("style");

    if (inlineStyle) {
      matches.push("inline style");
    }

    for (const sheet of Array.from(document.styleSheets)) {
      let rules;

      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }

      for (const rule of Array.from(rules)) {
        if (!(rule instanceof CSSStyleRule) || !hasTypographyDeclaration(rule.style)) {
          continue;
        }

        try {
          if (element.matches(rule.selectorText)) {
            matches.push(rule.selectorText);
          }
        } catch {
          continue;
        }
      }
    }

    return matches.slice(-5).join(" | ") || "computed/inherited styles";
  }

  function hasTypographyDeclaration(style) {
    return [
      "font-family",
      "font-size",
      "font-weight",
      "font-style",
      "line-height",
      "letter-spacing",
      "word-spacing",
      "text-transform",
      "text-decoration",
      "color",
    ].some((property) => style.getPropertyValue(property));
  }

  function getFontOrigin(renderedFontFamily, families) {
    const normalizedRendered = renderedFontFamily.toLowerCase();

    if (!renderedFontFamily || renderedFontFamily === "Unknown") {
      return "unknown";
    }

    if (COMMON_SYSTEM_FONTS.has(normalizedRendered)) {
      return "system font";
    }

    if (isDeclaredFontFace(renderedFontFamily)) {
      return "web font";
    }

    const firstFamily = families[0]?.toLowerCase();

    if (firstFamily && firstFamily !== normalizedRendered) {
      return "fallback candidate";
    }

    return "local or browser font";
  }

  function isDeclaredFontFace(fontFamily) {
    if (typeof CSSFontFaceRule === "undefined") {
      return false;
    }

    const target = fontFamily.toLowerCase();

    for (const sheet of Array.from(document.styleSheets)) {
      let rules;

      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }

      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSFontFaceRule) {
          const declaredFamily = rule.style.getPropertyValue("font-family").replace(/^['\"]|['\"]$/g, "").toLowerCase();

          if (declaredFamily === target) {
            return true;
          }
        }
      }
    }

    return false;
  }

  function describeElement(element) {
    const tag = element.tagName.toLowerCase();
    const id = element.id ? `#${safeIdentifier(element.id)}` : "";
    const classNames = Array.from(element.classList).slice(0, 3).map((className) => `.${safeIdentifier(className)}`).join("");

    return `${tag}${id}${classNames}`;
  }

  function safeIdentifier(value) {
    return value.replace(/[^a-z0-9_-]/gi, "_");
  }

  function isHeadingElement(element) {
    return /^h[1-6]$/i.test(element.tagName);
  }

  function increment(map, value) {
    const key = value || "normal";
    map.set(key, (map.get(key) ?? 0) + 1);
  }

  function topEntries(map, limit) {
    return Array.from(map, ([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
      .slice(0, limit);
  }

  function repeatedEntries(map, limit) {
    return topEntries(map, limit).filter((entry) => entry.count > 1);
  }

  function updateOverlay(element) {
    ensureOverlay();
    const rect = element.getBoundingClientRect();
    const styles = window.getComputedStyle(element);

    overlay.style.setProperty("transform", `translate(${Math.max(rect.left, 0)}px, ${Math.max(rect.top, 0)}px)`, "important");
    overlay.style.setProperty("width", `${Math.max(rect.width, 1)}px`, "important");
    overlay.style.setProperty("height", `${Math.max(rect.height, 1)}px`, "important");
    overlay.dataset.label = `${styles.fontFamily} / ${styles.fontSize} / ${styles.fontWeight}`;
  }

  function ensureOverlay() {
    if (overlay) {
      return;
    }

    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.setAttribute("aria-hidden", "true");
    document.documentElement.append(overlay);
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${OVERLAY_ID} {
        all: initial !important;
        position: fixed !important;
        z-index: 2147483647 !important;
        box-sizing: border-box !important;
        display: block !important;
        border: 2px solid #10b981 !important;
        border-radius: 6px !important;
        background: rgb(16 185 129 / 0.08) !important;
        box-shadow: 0 0 0 99999px rgb(2 6 23 / 0.08) !important;
        color: #052e1a !important;
        font: 700 11px/1.2 system-ui, sans-serif !important;
        pointer-events: none !important;
        transition: transform 80ms ease, width 80ms ease, height 80ms ease !important;
      }

      #${OVERLAY_ID}::before {
        all: initial !important;
        position: absolute !important;
        left: -2px !important;
        bottom: calc(100% + 4px) !important;
        max-width: min(360px, 90vw) !important;
        border-radius: 999px !important;
        padding: 6px 9px !important;
        background: #a7f3d0 !important;
        color: #052e1a !important;
        content: attr(data-label) !important;
        display: block !important;
        font: 700 11px/1.2 system-ui, sans-serif !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
      }
    `;
    document.documentElement.append(style);
  }

  function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
})();
