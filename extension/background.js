let lastShot = null;
chrome.action.onClicked.addListener(async (tab) => {
  try {
    lastShot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  } catch {
    lastShot = null;
  }
  chrome.tabs.create({ url: chrome.runtime.getURL("app/index.html" + (lastShot ? "#snip" : "")) });
});
const MENU_ID = "vs-blur-canvases";
const RECORD_ID = "vs-record-tab";
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: MENU_ID, title: "Blur text in charts on this page", contexts: ["page", "image", "frame"] });
  chrome.contextMenus.create({ id: RECORD_ID, title: "Record this tab (text masked) / stop", contexts: ["page", "image", "frame"] });
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (tab?.id === void 0) return;
  if (info.menuItemId === MENU_ID) void redactCanvases(tab.id);
  if (info.menuItemId === RECORD_ID) void recordTab(tab.id);
});
chrome.commands.onCommand.addListener((command, tab) => {
  if (tab?.id === void 0) return;
  if (command === "blur-canvases") void redactCanvases(tab.id);
  if (command === "record-tab") void recordTab(tab.id);
});
async function recordTab(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["recorder.js"] });
}
let lastRecording = null;
async function redactCanvases(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["canvas-ocr.js"] });
}
chrome.runtime.onMessage.addListener((msg, sender, send) => {
  if (msg?.type === "dsc-get-snip") {
    send({ dataUrl: lastShot });
    lastShot = null;
    return;
  }
  if (msg?.type === "vs-recording") {
    lastRecording = msg;
    chrome.tabs.create({ url: chrome.runtime.getURL("app/replay.html#recording") });
    send({ ok: true });
    return;
  }
  if (msg?.type === "vs-get-recording") {
    send(lastRecording);
    lastRecording = null;
    return;
  }
  if (msg?.type === "vs-canvas-capture") {
    const windowId = sender.tab?.windowId;
    if (windowId === void 0) return void send({ ok: false, error: "not sent from a tab" });
    chrome.tabs.captureVisibleTab(windowId, { format: "png" }).then(
      (dataUrl) => send({ ok: true, dataUrl }),
      (e) => send({ ok: false, error: String(e?.message ?? e) })
    );
    return true;
  }
  if (msg?.type === "vs-canvas-ocr") {
    ocr(msg.images).then(send, (e) => send({ ok: false, error: String(e?.message ?? e) }));
    return true;
  }
});
let creating = null;
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  creating ??= chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: [chrome.offscreen.Reason.WORKERS],
    justification: "Reads text in page charts on this device (Tesseract OCR in a worker) so it can be blurred."
  }).finally(() => {
    creating = null;
  });
  await creating;
}
async function ocr(images) {
  await ensureOffscreen();
  return chrome.runtime.sendMessage({ target: "offscreen", type: "vs-ocr", images });
}
globalThis.vaultsnip = { redactCanvases, recordTab };
export {
  recordTab,
  redactCanvases
};
