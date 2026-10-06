// VaultSnip extension: capture the visible tab on toolbar click, then open the app to crop and convert.
// The screenshot is held in memory only until the app asks for it once.
let lastShot = null;

chrome.action.onClicked.addListener(async (tab) => {
  try {
    lastShot = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  } catch (e) {
    lastShot = null; // e.g. chrome:// pages cannot be captured
  }
  chrome.tabs.create({ url: chrome.runtime.getURL('app/index.html' + (lastShot ? '#snip' : '')) });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'dsc-get-snip') {
    sendResponse({ dataUrl: lastShot });
    lastShot = null;
  }
});
