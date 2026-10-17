/**
 * Extension service worker. Toolbar click: capture the visible tab and open the app (as extension/background.js).
 * Canvas redaction (Feature 3): the "Blur text in charts on this page" menu item or Alt+Shift+B injects the
 * canvas redactor; it asks here for tab screenshots and OCR, which runs in an offscreen document.
 * Nothing is sent over the network, and nothing is stored.
 */
import type { CaptureReply, OcrReply, ToBackground, ToOffscreen } from './canvas-protocol';

let lastShot: string | null = null;

chrome.action.onClicked.addListener(async (tab) => {
  try {
    lastShot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  } catch {
    lastShot = null; // e.g. chrome:// pages cannot be captured
  }
  chrome.tabs.create({ url: chrome.runtime.getURL('app/index.html' + (lastShot ? '#snip' : '')) });
});

const MENU_ID = 'vs-blur-canvases';
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: MENU_ID, title: 'Blur text in charts on this page', contexts: ['page', 'image', 'frame'] });
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ID && tab?.id !== undefined) void redactCanvases(tab.id);
});
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'blur-canvases' && tab?.id !== undefined) void redactCanvases(tab.id);
});

/** Injects the canvas redactor. Running it again on the same page removes the redactions. */
export async function redactCanvases(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['canvas-ocr.js'] });
}

chrome.runtime.onMessage.addListener((msg: ToBackground, sender, send) => {
  if (msg?.type === 'dsc-get-snip') {
    send({ dataUrl: lastShot });
    lastShot = null;
    return;
  }
  if (msg?.type === 'vs-canvas-capture') {
    const windowId = sender.tab?.windowId;
    if (windowId === undefined) return void send({ ok: false, error: 'not sent from a tab' } satisfies CaptureReply);
    chrome.tabs.captureVisibleTab(windowId, { format: 'png' }).then(
      (dataUrl) => send({ ok: true, dataUrl } satisfies CaptureReply),
      (e) => send({ ok: false, error: String(e?.message ?? e) } satisfies CaptureReply),
    );
    return true;
  }
  if (msg?.type === 'vs-canvas-ocr') {
    ocr(msg.images).then(send, (e) => send({ ok: false, error: String(e?.message ?? e) } satisfies OcrReply));
    return true;
  }
});

let creating: Promise<void> | null = null;
async function ensureOffscreen(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return;
  creating ??= chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: [chrome.offscreen.Reason.WORKERS],
    justification: 'Reads text in page charts on this device (Tesseract OCR in a worker) so it can be blurred.',
  }).finally(() => { creating = null; });
  await creating;
}

async function ocr(images: ToOffscreen['images']): Promise<OcrReply> {
  await ensureOffscreen();
  return chrome.runtime.sendMessage({ target: 'offscreen', type: 'vs-ocr', images } satisfies ToOffscreen);
}

// For the end-to-end test, which cannot click the context menu.
(globalThis as { vaultsnip?: unknown }).vaultsnip = { redactCanvases };
