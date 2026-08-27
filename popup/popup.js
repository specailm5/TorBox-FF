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
          
          chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            if (tabs.length > 0) {
              chrome.scripting.executeScript({
                target: {tabId: tabs[0].id},
                func: (url) => {
                  const a = document.createElement('a');
                  a.href = url;
                  a.style.display = 'none';
                  document.body.appendChild(a);
                  a.click();
                  setTimeout(() => a.remove(), 1000);
                },
                args: [res.downloadUrl]
              });
            }
          });
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

  const pageLinksList = document.getElementById('pageLinksList');
  pageLinksList.addEventListener('click', (e) => {
    const btn = e.target.closest('.dl-action-btn');
    if (btn && btn.dataset.url && btn.dataset.action) {
      if (btn.classList.contains('downloading')) return;
      btn.classList.add('downloading');
      btn.innerHTML = '...';
      
      const url = btn.dataset.url;
      const actionMsg = btn.dataset.action === 'download' ? TorBoxConstants.MESSAGES.DOWNLOAD_CACHED : TorBoxConstants.MESSAGES.CREATE_WEBDL;
      
      chrome.runtime.sendMessage({
        action: actionMsg,
        url: url
      }, (res) => {
        if (res && res.success) {
          btn.innerHTML = btn.dataset.action === 'download' ? 'Started' : 'Added';
          btn.style.background = 'var(--success)';
          btn.style.borderColor = 'var(--success)';
          
          if (res.downloadUrl) {
            chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
              if (tabs.length > 0) {
                chrome.scripting.executeScript({
                  target: {tabId: tabs[0].id},
                  func: (dUrl) => {
                    const a = document.createElement('a');
                    a.href = dUrl;
                    a.style.display = 'none';
                    document.body.appendChild(a);
                    a.click();
                    setTimeout(() => a.remove(), 1000);
                  },
                  args: [res.downloadUrl]
                });
              }
            });
          }
        } else {
          btn.innerHTML = 'Failed';
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
      const tabId = tabs[0].id;
      
      chrome.storage.local.get(['displayMode'], (result) => {
        const mode = result.displayMode || 'buttons';
        const statsBox = document.querySelector('.stats-box');
        const scanBtn = document.getElementById('scanBtn');
        
        if (mode === 'list') {
          document.getElementById('pageLinksContainer').style.display = 'flex';
          if (statsBox) statsBox.style.display = 'none';
          if (scanBtn) scanBtn.style.display = 'none';
          
          chrome.tabs.sendMessage(tabId, { action: TorBoxConstants.MESSAGES.GET_PAGE_LINKS }, (response) => {
            if (chrome.runtime.lastError || !response || !response.links) return;
            const links = response.links;
            let cached = 0, notCached = 0, pending = 0;
            let html = '';
            
            const groups = {};
            links.forEach(link => {
              if (link.state === TorBoxConstants.STATES.CACHED) cached++;
              else if (link.state === TorBoxConstants.STATES.NOT_CACHED) notCached++;
              else pending++;
              
              const g = link.group || 'Page Links';
              if (!groups[g]) groups[g] = [];
              groups[g].push(link);
            });
            
            Object.keys(groups).forEach(groupName => {
              html += `<div style="padding: 6px 8px; margin: 12px 0 6px 0; background: var(--bg-tertiary); border-radius: 4px; font-weight: 600; font-size: 11px; color: var(--text-primary); border-left: 3px solid var(--primary);">${groupName}</div>`;
              
              groups[groupName].forEach(link => {
                let statusColor = 'var(--text-muted)';
                let btnHtml = '';
                let stateText = 'Checking...';
                
                if (link.state === TorBoxConstants.STATES.CACHED) {
                  statusColor = 'var(--success)';
                  stateText = 'Cached';
                  btnHtml = `<button class="btn primary dl-action-btn" data-url="${link.url}" data-action="download" style="padding: 4px 8px; font-size: 11px;">DL</button>`;
                } else if (link.state === TorBoxConstants.STATES.NOT_CACHED) {
                  statusColor = 'var(--text-muted)';
                  stateText = 'Not cached';
                  btnHtml = `<button class="btn primary dl-action-btn" data-url="${link.url}" data-action="upload" style="padding: 4px 8px; font-size: 11px; background: #7c3aed; border-color: #6d28d9;">To TB</button>`;
                } else if (link.state === TorBoxConstants.STATES.ERROR) {
                  statusColor = 'var(--error)';
                  stateText = 'Error';
                }
                
                let displayUrl = link.text && link.text.length > 2 ? link.text : link.url;
                
                // Fallback URL formatting if the text wasn't useful
                if (displayUrl === link.url) {
                  if (displayUrl.startsWith('magnet:')) {
                    const match = displayUrl.match(/xt=urn:btih:([a-zA-Z0-9]+)/i);
                    if (match) {
                      displayUrl = 'Magnet: ' + match[1].substring(0, 12) + '...';
                    } else {
                      displayUrl = 'Magnet Link';
                    }
                  } else {
                    try {
                      const u = new URL(link.url);
                      let path = u.pathname !== '/' ? u.pathname : '';
                      if (path.length > 30) {
                         path = '/...' + path.split('/').filter(Boolean).pop();
                      }
                      displayUrl = u.hostname + path;
                    } catch(e) {}
                  }
                }
                
                html += `
                  <div class="dl-item" style="padding: 8px; margin-bottom: 4px; border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-secondary);">
                    <div class="dl-name" title="${link.url}" style="word-break: break-all; font-size: 11px;">${displayUrl}</div>
                    <div class="dl-meta" style="margin-top: 4px; display: flex; justify-content: space-between; align-items: center;">
                      <span style="color: ${statusColor}; font-size: 11px; font-weight: 600;">${stateText}</span>
                      ${btnHtml}
                    </div>
                  </div>
                `;
              });
            });
            
            if (links.length === 0) {
              html = '<div class="loading-text">No links found on this page.</div>';
            }
            document.getElementById('pageLinksList').innerHTML = html;
            
            document.getElementById('countCached').textContent = cached;
            document.getElementById('countNotCached').textContent = notCached;
            document.getElementById('countPending').textContent = pending;
          });
        } else {
          document.getElementById('pageLinksContainer').style.display = 'none';
          if (statsBox) statsBox.style.display = '';
          if (scanBtn) scanBtn.style.display = '';
          
          chrome.scripting.executeScript({
            target: {tabId: tabId},
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
        }
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
