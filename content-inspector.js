(() => {
  if (window.__typeInspectorLoaded) {
    return;
  }

  window.__typeInspectorLoaded = true;

  const OVERLAY_ID = "type-inspector-overlay";
  const STYLE_ID = "type-inspector-style";
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
    const candidate = getInspectableElement(event.target);

    if (!candidate || candidate === highlightedElement) {
      return;
    }

    highlightedElement = candidate;
    updateOverlay(candidate);
  }

  function handleClick(event) {
    const candidate = getInspectableElement(event.target);

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

  function getInspectableElement(target) {
    if (!(target instanceof Element) || target.id === OVERLAY_ID || target.closest(`#${OVERLAY_ID}`)) {
      return null;
    }

    const element = target.closest("p, span, a, button, label, li, h1, h2, h3, h4, h5, h6, blockquote, figcaption, th, td, dt, dd, code, pre") ?? target;
    const text = element.textContent?.trim();

    return text ? element : null;
  }

  function captureTypography(element) {
    const styles = window.getComputedStyle(element);

    return {
      renderedFontFamily: getRenderedFontFamily(element) || "Unknown",
      fontFamily: styles.fontFamily,
      fontSize: styles.fontSize,
      fontWeight: styles.fontWeight,
      lineHeight: styles.lineHeight,
      letterSpacing: styles.letterSpacing,
      fontStyle: styles.fontStyle,
      color: styles.color,
      backgroundColor: getVisibleBackgroundColor(element),
      element: describeElement(element),
      capturedAt: new Date().toISOString(),
    };
  }

  function getRenderedFontFamily(element) {
    if (!document.fonts?.check) {
      return "";
    }

    const styles = window.getComputedStyle(element);
    const fontSize = styles.fontSize || "16px";
    const families = splitFontFamilies(styles.fontFamily);

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

  function describeElement(element) {
    const tag = element.tagName.toLowerCase();
    const id = element.id ? `#${safeIdentifier(element.id)}` : "";
    const classNames = Array.from(element.classList).slice(0, 3).map((className) => `.${safeIdentifier(className)}`).join("");

    return `${tag}${id}${classNames}`;
  }

  function safeIdentifier(value) {
    return value.replace(/[^a-z0-9_-]/gi, "_");
  }

  function updateOverlay(element) {
    ensureOverlay();
    const rect = element.getBoundingClientRect();
    const styles = window.getComputedStyle(element);

    overlay.style.transform = `translate(${Math.max(rect.left, 0)}px, ${Math.max(rect.top, 0)}px)`;
    overlay.style.width = `${Math.max(rect.width, 1)}px`;
    overlay.style.height = `${Math.max(rect.height, 1)}px`;
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
        position: fixed;
        z-index: 2147483647;
        box-sizing: border-box;
        border: 2px solid #10b981;
        border-radius: 6px;
        background: rgb(16 185 129 / 0.08);
        box-shadow: 0 0 0 99999px rgb(2 6 23 / 0.08);
        color: #052e1a;
        font: 700 11px/1.2 system-ui, sans-serif;
        pointer-events: none;
        transition: transform 80ms ease, width 80ms ease, height 80ms ease;
      }

      #${OVERLAY_ID}::before {
        position: absolute;
        left: -2px;
        bottom: calc(100% + 4px);
        max-width: min(360px, 90vw);
        border-radius: 999px;
        padding: 6px 9px;
        background: #a7f3d0;
        color: #052e1a;
        content: attr(data-label);
      }
    `;
    document.documentElement.append(style);
  }

  function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
})();
