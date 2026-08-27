document.addEventListener('DOMContentLoaded', () => {
  const openSettings = document.getElementById('openSettings');
  const scanBtn = document.getElementById('scanBtn');
  
  openSettings.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  scanBtn.addEventListener('click', () => {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (tabs.length === 0) return;
      const tabId = tabs[0].id;
      // Execute the scanner logic by running a script in the active tab
      chrome.scripting.executeScript({
        target: {tabId: tabId},
        func: () => {
          if (window.torBoxScanner) {
            window.torBoxScanner.startScanning();
            return true;
          }
          return false;
        }
      });
      // A small delay to let it scan
      setTimeout(updateStats, 500);
    });
  });

  function updateStats() {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (tabs.length === 0) return;
      
      chrome.scripting.executeScript({
        target: {tabId: tabs[0].id},
        func: () => {
          if (!window.torBoxUI) return { cached: 0, notCached: 0, pending: 0 };
          
          let cached = 0, notCached = 0, pending = 0;
          
          for (const data of window.torBoxUI.indicators.values()) {
            if (data.badge.classList.contains('cached')) cached++;
            else if (data.badge.classList.contains('not-cached')) notCached++;
            else if (data.badge.classList.contains('checking')) pending++;
          }
          return { cached, notCached, pending };
        }
      }, (injectionResults) => {
        if (chrome.runtime.lastError || !injectionResults || !injectionResults[0].result) return;
        
        const stats = injectionResults[0].result;
        document.getElementById('countCached').textContent = stats.cached;
        document.getElementById('countNotCached').textContent = stats.notCached;
        document.getElementById('countPending').textContent = stats.pending;
      });
    });
  }

  // Update stats initially and every second while popup is open
  updateStats();
  setInterval(updateStats, 1000);
});
