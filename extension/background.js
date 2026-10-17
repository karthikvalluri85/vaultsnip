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
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: MENU_ID, title: "Blur text in charts on this page", contexts: ["page", "image", "frame"] });
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ID && tab?.id !== void 0) void redactCanvases(tab.id);
});
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "blur-canvases" && tab?.id !== void 0) void redactCanvases(tab.id);
});
async function redactCanvases(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["canvas-ocr.js"] });
}
chrome.runtime.onMessage.addListener((msg, sender, send) => {
  if (msg?.type === "dsc-get-snip") {
    send({ dataUrl: lastShot });
    lastShot = null;
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
globalThis.vaultsnip = { redactCanvases };
export {
  redactCanvases
};
