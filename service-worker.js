chrome.runtime.onMessage.addListener((message, sender) => {
  if (!isRecord(message)) {
    return false;
  }

  if (message.type === "type-inspector:capture" && isCapturePayload(message.payload)) {
    void chrome.storage.local.set({ latestCapture: message.payload });
    return false;
  }

  if (message.type === "type-inspector:ended" && sender.tab?.id) {
    void chrome.action.setBadgeText({ tabId: sender.tab.id, text: "" });
    return false;
  }

  return false;
});

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isCapturePayload(payload) {
  return isRecord(payload)
    && typeof payload.fontFamily === "string"
    && typeof payload.fontSize === "string"
    && typeof payload.element === "string";
}
