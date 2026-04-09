// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// Auto-enable side panel only on Google Sheets tabs
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  const isSheets = tab.url?.includes('docs.google.com/spreadsheets');
  chrome.sidePanel.setOptions({
    tabId,
    path: 'popup.html',
    enabled: !!isSheets,
  });
});
