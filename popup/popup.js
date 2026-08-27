document.addEventListener('DOMContentLoaded', () => {
  const openSettings = document.getElementById('openSettings');
  const scanBtn = document.getElementById('scanBtn');
  const tabs = document.querySelectorAll('.tab');
  const tabContents = document.querySelectorAll('.tab-content');
  
  // Settings Button
  openSettings.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  // Tab Switching
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Remove active from all
      tabs.forEach(t => t.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      
      // Add active to clicked
      tab.classList.add('active');
      document.getElementById('tab-' + tab.dataset.tab).classList.add('active');

      if (tab.dataset.tab === 'downloads') {
        fetchDownloads();
      }
    });
  });

  // Scan Button
  scanBtn.addEventListener('click', () => {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      if (tabs.length === 0) return;
      const tabId = tabs[0].id;
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
      setTimeout(updateStats, 500);
    });
  });

  // Download Button Click Delegation
  const downloadsList = document.getElementById('downloadsList');
  downloadsList.addEventListener('click', (e) => {
    const btn = e.target.closest('.dl-action-btn');
    if (btn && btn.dataset.id && btn.dataset.type) {
      if (btn.classList.contains('downloading')) return;
      btn.classList.add('downloading');
      btn.innerHTML = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width: 12px; height: 12px; margin-right: 4px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg> ...`;
      
      chrome.runtime.sendMessage({
        action: TorBoxConstants.MESSAGES.REQUEST_DOWNLOAD_BY_ID,
        id: parseInt(btn.dataset.id),
        type: btn.dataset.type
      }, (res) => {
        if (res && res.success && res.downloadUrl) {
          btn.innerHTML = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width: 12px; height: 12px; margin-right: 4px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg> Started`;
          btn.style.background = 'var(--success)';
          btn.style.borderColor = 'var(--success)';
          const a = document.createElement('a');
          a.href = res.downloadUrl;
          a.style.display = 'none';
          document.body.appendChild(a);
          a.click();
          setTimeout(() => a.remove(), 1000);
        } else {
          btn.innerHTML = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width: 12px; height: 12px; margin-right: 4px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg> Failed`;
          btn.style.background = 'var(--error)';
          btn.style.borderColor = 'var(--error)';
          btn.title = res ? res.error : 'Unknown error';
          btn.classList.remove('downloading');
        }
      });
    }
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

  let isFirstDownloadsLoad = true;

  function fetchDownloads() {
    const list = document.getElementById('downloadsList');
    if (isFirstDownloadsLoad) {
      list.innerHTML = '<div class="loading-text">Loading downloads...</div>';
    }
    
    chrome.runtime.sendMessage({ action: TorBoxConstants.MESSAGES.GET_ACTIVE_DOWNLOADS }, (res) => {
      isFirstDownloadsLoad = false;
      if (!res || !res.success) {
        list.innerHTML = '<div class="loading-text" style="color:var(--error)">Failed to load.</div>';
        return;
      }
      
      let dls = res.downloads;
      if (dls.length === 0) {
        list.innerHTML = '<div class="loading-text">No active downloads.</div>';
        return;
      }

      dls.sort((a, b) => b.id - a.id);
      let toShow = dls.filter(dl => dl.status !== 'completed' && dl.status !== 'cached');
      if (toShow.length === 0) {
        toShow = [dls[0]];
      }

      let newHtml = '';
      toShow.forEach(dl => {
        let statusColor = 'var(--text-muted)';
        if (dl.status === 'downloading') statusColor = 'var(--primary)';
        if (dl.status === 'completed' || dl.status === 'cached') statusColor = 'var(--success)';
        
        const speedStr = dl.speed > 0 ? ` - ${(dl.speed / 1024 / 1024).toFixed(2)} MB/s` : '';

        let dlAction = '';
        if (dl.status === 'completed' || dl.status === 'cached') {
          dlAction = `
            <button class="btn primary dl-action-btn" data-id="${dl.id}" data-type="${dl.type}" style="padding: 4px 8px; font-size: 11px; margin-left: 8px; display: inline-flex; align-items: center;">
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" style="width: 12px; height: 12px; margin-right: 4px;"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg> Download
            </button>
          `;
        }

        newHtml += `
          <div class="dl-item">
            <div class="dl-name" title="${dl.name}">${dl.name}</div>
            <div class="dl-meta">
              <div style="display:flex; align-items:center;">
                <span class="dl-status" style="color:${statusColor}">${dl.status} [${dl.type.toUpperCase()}]</span>
                ${dlAction}
              </div>
              <span>${(dl.progress * 100).toFixed(1)}%${speedStr}</span>
            </div>
            <div class="dl-progress-bar">
              <div class="dl-progress-fill" style="width: ${dl.progress * 100}%"></div>
            </div>
          </div>
        `;
      });
      list.innerHTML = newHtml;
    });
  }

  // Update stats initially and every second while popup is open (if on stats tab)
  updateStats();
  setInterval(() => {
    if (document.querySelector('.tab[data-tab="stats"]').classList.contains('active')) {
      updateStats();
    } else if (document.querySelector('.tab[data-tab="downloads"]').classList.contains('active')) {
      fetchDownloads();
    }
  }, 3000); // 3s for fetching downloads to not spam API too hard
});
