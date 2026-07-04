(() => {
  if (window.__typeInspectorLoaded) {
    return;
  }

  window.__typeInspectorLoaded = true;

  const OVERLAY_ID = "type-inspector-overlay";
  const OVERLAY_HOST_ID = "type-inspector-overlay-host";
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
  const EVENT_OPTIONS = { capture: true, passive: false };
  const BLOCKED_EVENTS = [
    "click",
    "dblclick",
    "auxclick",
    "mousedown",
    "mouseup",
    "pointerdown",
    "pointerup",
    "touchstart",
    "touchend",
  ];
  let overlayHost = null;
  let overlay = null;
  let overlayLabel = null;
  let overlayUnavailable = null;
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
    ensureOverlay();
    document.addEventListener("mousemove", handleMouseMove, EVENT_OPTIONS);
    document.addEventListener("pointermove", handleMouseMove, EVENT_OPTIONS);
    document.addEventListener("keydown", handleKeyDown, EVENT_OPTIONS);

    for (const eventName of BLOCKED_EVENTS) {
      document.addEventListener(eventName, handleBlockedPointerEvent, EVENT_OPTIONS);
    }
  }

  function stopInspection() {
    if (!active) {
      return;
    }

    active = false;
    highlightedElement = null;
    document.removeEventListener("mousemove", handleMouseMove, EVENT_OPTIONS);
    document.removeEventListener("pointermove", handleMouseMove, EVENT_OPTIONS);
    document.removeEventListener("keydown", handleKeyDown, EVENT_OPTIONS);

    for (const eventName of BLOCKED_EVENTS) {
      document.removeEventListener(eventName, handleBlockedPointerEvent, EVENT_OPTIONS);
    }

    overlayHost?.remove();
    overlayHost = null;
    overlay = null;
    overlayLabel = null;
    overlayUnavailable = null;
    chrome.runtime.sendMessage({ type: "type-inspector:ended" });
  }

  function handleMouseMove(event) {
    const candidate = getInspectableElement(event);

    if (!candidate) {
      highlightedElement = null;
      if (isEmbeddedContentTarget(event)) {
        updateUnavailableOverlay(event, "Cannot inspect text inside this embedded content");
      } else {
        hideOverlay();
      }
      return;
    }

    if (candidate === highlightedElement) {
      return;
    }

    highlightedElement = candidate;
    updateOverlay(candidate);
  }

  function handleBlockedPointerEvent(event) {
    blockPageEvent(event);

    if (event.type !== "click") {
      return;
    }

    const candidate = getInspectableElement(event);

    if (candidate) {
      chrome.runtime.sendMessage({
        type: "type-inspector:capture",
        payload: captureTypography(candidate),
      });
      stopInspection();
    }
  }

  function blockPageEvent(event) {
    if (!active) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }

  function handleKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      stopInspection();
    }
  }

  function getInspectableElement(event) {
    const textNodeElement = getTextNodeElementFromPoint(event);

    if (textNodeElement) {
      return textNodeElement;
    }

    const target = getTargetFromPoint(event) ?? getComposedPathElement(event);

    if (!(target instanceof Element) || isInspectorElement(target)) {
      return null;
    }

    const element = getDeepestTextElementAtPoint(target, event.clientX, event.clientY)
      ?? target.closest(TEXT_ELEMENT_SELECTOR)
      ?? target;
    const text = element.textContent?.trim();

    return text ? element : null;
  }

  function getTextNodeElementFromPoint(event) {
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
      return null;
    }

    const position = getCaretPositionFromPoint(event.clientX, event.clientY);
    const node = position?.node;

    if (node?.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) {
      return null;
    }

    const parentElement = node.parentElement;

    if (!parentElement || isInspectorElement(parentElement) || !isVisibleElement(parentElement)) {
      return null;
    }

    return parentElement.closest(TEXT_ELEMENT_SELECTOR) ?? parentElement;
  }

  function getCaretPositionFromPoint(clientX, clientY) {
    if (document.caretPositionFromPoint) {
      const position = document.caretPositionFromPoint(clientX, clientY);

      return position ? { node: position.offsetNode, offset: position.offset } : null;
    }

    if (document.caretRangeFromPoint) {
      const range = document.caretRangeFromPoint(clientX, clientY);

      return range ? { node: range.startContainer, offset: range.startOffset } : null;
    }

    return null;
  }

  function getTargetFromPoint(event) {
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
      return null;
    }

    const rootTarget = document.elementsFromPoint(event.clientX, event.clientY)
      .find((element) => !isInspectorElement(element)) ?? null;

    return getDeepestElementFromPoint(rootTarget, event.clientX, event.clientY);
  }

  function getComposedPathElement(event) {
    return event.composedPath?.().find((entry) => entry instanceof Element && !isInspectorElement(entry)) ?? null;
  }

  function getDeepestElementFromPoint(element, clientX, clientY) {
    let current = element;

    while (current?.shadowRoot) {
      const shadowTarget = current.shadowRoot.elementsFromPoint(clientX, clientY)
        .find((entry) => entry instanceof Element);

      if (!shadowTarget || shadowTarget === current) {
        break;
      }

      current = shadowTarget;
    }

    return current;
  }

  function isInspectorElement(element) {
    return element.id === OVERLAY_HOST_ID || element.id === OVERLAY_ID || Boolean(element.closest?.(`#${OVERLAY_HOST_ID}`));
  }

  function getDeepestTextElementAtPoint(root, clientX, clientY) {
    const matches = Array.from(root.querySelectorAll?.(TEXT_ELEMENT_SELECTOR) ?? [])
      .filter((element) => element.textContent?.trim() && isVisibleElement(element) && containsPoint(element, clientX, clientY));

    return matches.at(-1) ?? (root.matches?.(TEXT_ELEMENT_SELECTOR) ? root : null);
  }

  function containsPoint(element, clientX, clientY) {
    return Array.from(element.getClientRects()).some((rect) => (
      clientX >= rect.left
      && clientX <= rect.right
      && clientY >= rect.top
      && clientY <= rect.bottom
    ));
  }

  function isEmbeddedContentTarget(event) {
    const target = getTargetFromPoint(event) ?? getComposedPathElement(event);

    return target instanceof Element && Boolean(target.closest("iframe, embed, object"));
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
      topSelector: getTopSpecificitySelector(element),
      fontFamilySelector: getPropertySelector(element, "font-family"),
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

    for (const element of summaryElements) {
      const styles = window.getComputedStyle(element);
      const familyList = splitFontFamilies(styles.fontFamily);
      const primaryFamily = familyList[0] ?? styles.fontFamily;
      const pattern = `${styles.fontFamily} / ${styles.fontSize} / ${styles.fontWeight} / ${styles.lineHeight}`;

      increment(families, primaryFamily || "Unknown");
      increment(sizes, styles.fontSize);
      increment(weights, styles.fontWeight);
      increment(isHeadingElement(element) ? headingStyles : bodyStyles, pattern);
    }

    return {
      scannedVisibleTextElements: String(summaryElements.length),
      uniqueFontFamilies: topEntries(families, 12),
      commonSizes: topEntries(sizes, 10),
      commonWeights: topEntries(weights, 10),
      headingPatterns: topEntries(headingStyles, 6),
      bodyPatterns: topEntries(bodyStyles, 6),
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

  function getTopSpecificitySelector(element) {
    const matches = getMatchingStyleRules(element)
      .sort(compareRuleMatch)
      .reverse();

    return matches[0]?.selectorText ?? "inline/computed style";
  }

  function getPropertySelector(element, propertyName) {
    if (element.style.getPropertyValue(propertyName)) {
      return "inline style";
    }

    const matches = getMatchingStyleRules(element)
      .filter((match) => match.rule.style.getPropertyValue(propertyName))
      .sort(compareRuleMatch)
      .reverse();

    return matches[0]?.selectorText ?? "inherited/computed style";
  }

  function getMatchingStyleRules(element) {
    const matches = [];
    let order = 0;

    for (const sheet of Array.from(document.styleSheets)) {
      let rules;

      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }

      for (const rule of Array.from(rules)) {
        order += 1;

        if (!(rule instanceof CSSStyleRule)) {
          continue;
        }

        for (const selector of splitSelectorList(rule.selectorText)) {
          try {
            if (!element.matches(selector)) {
              continue;
            }

            matches.push({
              rule,
              order,
              selectorText: selector,
              specificity: calculateSpecificity(selector),
            });
          } catch {
            continue;
          }
        }
      }
    }

    return matches;
  }

  function compareRuleMatch(a, b) {
    return compareSpecificity(a.specificity, b.specificity) || a.order - b.order;
  }

  function compareSpecificity(a, b) {
    return (a.ids - b.ids) || (a.classes - b.classes) || (a.elements - b.elements);
  }

  function splitSelectorList(selectorText) {
    const selectors = [];
    let current = "";
    let depth = 0;
    let quote = "";

    for (const character of selectorText) {
      if (quote) {
        current += character;

        if (character === quote) {
          quote = "";
        }

        continue;
      }

      if (character === "\"" || character === "'") {
        quote = character;
        current += character;
        continue;
      }

      if (character === "(" || character === "[") {
        depth += 1;
      } else if (character === ")" || character === "]") {
        depth = Math.max(depth - 1, 0);
      }

      if (character === "," && depth === 0) {
        if (current.trim()) {
          selectors.push(current.trim());
        }

        current = "";
        continue;
      }

      current += character;
    }

    if (current.trim()) {
      selectors.push(current.trim());
    }

    return selectors;
  }

  function calculateSpecificity(selector) {
    const withoutStrings = selector.replace(/(['"]).*?\1/g, "");
    const ids = (withoutStrings.match(/#[\w-]+/g) ?? []).length;
    const classes = (withoutStrings.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+(?:\([^)]*\))?/g) ?? []).length;
    const elements = (withoutStrings
      .replace(/#[\w-]+/g, " ")
      .replace(/\.[\w-]+|\[[^\]]+\]|:{1,2}[\w-]+(?:\([^)]*\))?/g, " ")
      .match(/(^|[\s>+~])([a-z][\w-]*)/gi) ?? []).length;

    return { ids, classes, elements };
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
    const shadowRoot = element.getRootNode();
    const shadowPrefix = shadowRoot instanceof ShadowRoot ? "shadow " : "";
    const id = element.id ? `#${safeIdentifier(element.id)}` : "";
    const classNames = Array.from(element.classList).slice(0, 3).map((className) => `.${safeIdentifier(className)}`).join("");

    return `${shadowPrefix}${tag}${id}${classNames}`;
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

  function updateOverlay(element) {
    ensureOverlay();
    const rect = element.getBoundingClientRect();
    const styles = window.getComputedStyle(element);

    overlayUnavailable.hidden = true;
    overlay.hidden = false;
    overlay.style.transform = `translate(${Math.max(rect.left, 0)}px, ${Math.max(rect.top, 0)}px)`;
    overlay.style.width = `${Math.max(rect.width, 1)}px`;
    overlay.style.height = `${Math.max(rect.height, 1)}px`;
    overlayLabel.textContent = `${styles.fontFamily} / ${styles.fontSize} / ${styles.fontWeight}`;
  }

  function updateUnavailableOverlay(event, message) {
    ensureOverlay();

    overlay.hidden = true;
    overlayUnavailable.hidden = false;
    overlayUnavailable.style.transform = `translate(${Math.max(event.clientX + 12, 0)}px, ${Math.max(event.clientY + 12, 0)}px)`;
    overlayUnavailable.textContent = message;
  }

  function hideOverlay() {
    ensureOverlay();
    overlay.hidden = true;
    overlayUnavailable.hidden = true;
  }

  function ensureOverlay() {
    if (overlayHost && overlay && overlayLabel && overlayUnavailable) {
      return;
    }

    overlayHost = document.createElement("div");
    overlayHost.id = OVERLAY_HOST_ID;
    overlayHost.setAttribute("aria-hidden", "true");

    const shadowRoot = overlayHost.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlayLabel = document.createElement("div");
    overlayLabel.className = "label";
    overlayUnavailable = document.createElement("div");
    overlayUnavailable.className = "unavailable";
    overlayUnavailable.hidden = true;

    style.textContent = `
      :host {
        all: initial;
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: block;
        pointer-events: auto;
        cursor: crosshair;
      }

      #${OVERLAY_ID} {
        all: initial;
        position: fixed;
        box-sizing: border-box;
        display: block;
        border: 2px solid #10b981;
        border-radius: 6px;
        background: rgb(16 185 129 / 0.08);
        box-shadow: 0 0 0 99999px rgb(2 6 23 / 0.08);
        pointer-events: none;
        transition: transform 80ms ease, width 80ms ease, height 80ms ease;
      }

      .label {
        all: initial;
        position: absolute;
        left: -2px;
        bottom: calc(100% + 4px);
        max-width: min(360px, 90vw);
        border-radius: 999px;
        padding: 6px 9px;
        background: #a7f3d0;
        color: #052e1a;
        display: block;
        font: 700 11px/1.2 system-ui, sans-serif;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .unavailable {
        all: initial;
        position: fixed;
        max-width: min(320px, 80vw);
        border: 1px solid rgb(251 191 36 / 0.7);
        border-radius: 999px;
        padding: 7px 10px;
        background: #111827;
        box-shadow: 0 10px 24px rgb(0 0 0 / 0.24);
        color: #fde68a;
        display: block;
        font: 700 12px/1.2 system-ui, sans-serif;
        pointer-events: none;
      }
    `;

    overlay.append(overlayLabel);
    shadowRoot.append(style, overlay, overlayUnavailable);
    document.documentElement.append(overlayHost);
  }

  function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
})();
