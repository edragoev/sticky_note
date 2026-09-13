document.addEventListener("DOMContentLoaded", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const pageKey = "notes:" + tab.url;

  chrome.storage.local.get([pageKey], (result) => {
    const notes = result[pageKey] || [];
    document.getElementById("note-count").textContent =
      `${notes.length} note(s) on this page`;
  });

  document.getElementById("add-note-btn").addEventListener("click", () => {
    chrome.tabs.sendMessage(tab.id, { action: "add-note" });
    window.close();
  });

  document.getElementById("toggle-sidebar-btn").addEventListener("click", () => {
    chrome.tabs.sendMessage(tab.id, { action: "toggle-sidebar" });
    window.close();
  });

  document.getElementById("clear-notes-btn").addEventListener("click", () => {
    chrome.storage.local.set({ [pageKey]: [] });
    chrome.tabs.reload(tab.id);
  });
});