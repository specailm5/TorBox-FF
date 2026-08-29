/**
 * TorBox Popup Dashboard Controller
 */

document.addEventListener('DOMContentLoaded', () => {
  // Navigation & Header Elements
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');
  const openSettingsBtn = document.getElementById('openSettingsBtn');
  const accountPill = document.getElementById('accountPill');
  const userTierBadge = document.getElementById('userTierBadge');
  const userQuota = document.getElementById('userQuota');
  const activeDlCountBadge = document.getElementById('activeDlCountBadge');

  // Scanner Tab Elements
  const countCachedEl = document.getElementById('countCached');
  const countNotCachedEl = document.getElementById('countNotCached');
  const countTotalEl = document.getElementById('countTotal');
  const batchActionBar = document.getElementById('batchActionBar');
  const batchCachedCountEl = document.getElementById('batchCachedCount');
  const batchDownloadCachedBtn = document.getElementById('batchDownloadCachedBtn');
  const batchAddCloudBtn = document.getElementById('batchAddCloudBtn');
  const linkSearchInput = document.getElementById('linkSearchInput');
  const rescanPageBtn = document.getElementById('rescanPageBtn');
  const scannerChips = document.querySelectorAll('.filter-chips .chip');
  const pageLinksList = document.getElementById('pageLinksList');

  // Quick Debrid Elements
  const debridInput = document.getElementById('debridInput');
  const debridCheckBtn = document.getElementById('debridCheckBtn');
  const debridResultBox = document.getElementById('debridResultBox');

  // Cloud Activity Elements
  const downloadsList = document.getElementById('downloadsList');
  const refreshDownloadsBtn = document.getElementById('refreshDownloadsBtn');
  const dlFilterChips = document.querySelectorAll('[data-dl-filter]');

  // Internal State
  let currentTab = 'scanner';
  let scannerFilter = 'all';
  let dlFilter = 'all';
  let pageLinksCache = [];
  let downloadsCache = [];
  let pollInterval = null;

  // 1. Settings Link
  openSettingsBtn.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  accountPill.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // 2. Tab Navigation
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      tabPanels.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const tabId = btn.dataset.tab;
      currentTab = tabId;
      document.getElementById(`tab-${tabId}`).classList.add('active');

      if (tabId === 'downloads') {
        fetchDownloads();
      } else if (tabId === 'scanner') {
        fetchPageLinks();
      }
    });
  });

  // 3. Load User Profile Info
  function loadUserInfo() {
    chrome.runtime.sendMessage({ action: TorBoxConstants.MESSAGES.GET_USER_INFO }, (res) => {
      if (res && res.success && res.user) {
        const u = res.user;
        userTierBadge.textContent = u.planBadge || 'USER';
        userTierBadge.style.background = u.planColor || '#3b82f6';

        if (u.bandwidthLimit > 0) {
          const usedStr = TorBoxUtils.formatBytes(u.bandwidthUsed, 1);
          const limitStr = TorBoxUtils.formatBytes(u.bandwidthLimit, 0);
          userQuota.textContent = `${usedStr} / ${limitStr}`;
        } else {
          userQuota.textContent = u.username || 'Active';
        }
      } else {
        userTierBadge.textContent = 'CONFIG';
        userTierBadge.style.background = '#ef4444';
        userQuota.textContent = 'Set API Key';
      }
    });
  }

  // 4. Scanner Tab Controller
  function fetchPageLinks() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs || tabs.length === 0) {
        renderScannerEmpty("No active browser tab found.");
        return;
      }

      const activeTab = tabs[0];
      chrome.tabs.sendMessage(activeTab.id, { action: TorBoxConstants.MESSAGES.GET_PAGE_LINKS }, (res) => {
        if (chrome.runtime.lastError || !res || !res.links) {
          renderScannerEmpty("No downloadable links detected on this page, or page scanning is restricted.");
          updateStatsCounters(0, 0, 0);
          return;
        }

        pageLinksCache = res.links;
        renderScannerList();
      });
    });
  }

  function updateStatsCounters(cached, notCached, total) {
    countCachedEl.textContent = cached;
    countNotCachedEl.textContent = notCached;
    countTotalEl.textContent = total;

    if (cached > 0) {
      batchActionBar.style.display = 'flex';
      batchCachedCountEl.textContent = cached;
    } else {
      batchActionBar.style.display = 'none';
    }
  }

  function renderScannerEmpty(message) {
    pageLinksList.innerHTML = `
      <div class="empty-state">
        <p>${message}</p>
        <button id="triggerScanNowBtn" class="btn btn-emerald" style="margin-top:8px; padding:6px 12px; font-size:11px;">
          ⚡ Force Scan Page
        </button>
      </div>
    `;
    const btn = document.getElementById('triggerScanNowBtn');
    if (btn) {
      btn.addEventListener('click', forceScanPage);
    }
  }

  function forceScanPage() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length === 0) return;
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: () => {
          if (window.torBoxScanner) {
            window.torBoxScanner.startScanning();
            return true;
          }
          return false;
        }
      }, () => {
        setTimeout(fetchPageLinks, 600);
      });
    });
  }

  function renderScannerList() {
    const query = (linkSearchInput.value || '').trim().toLowerCase();
    let cachedCount = 0;
    let notCachedCount = 0;

    pageLinksCache.forEach(link => {
      if (link.state === TorBoxConstants.STATES.CACHED) cachedCount++;
      else if (link.state === TorBoxConstants.STATES.NOT_CACHED) notCachedCount++;
    });

    updateStatsCounters(cachedCount, notCachedCount, pageLinksCache.length);

    let filtered = pageLinksCache.filter(link => {
      // Search filter
      if (query) {
        const matchesQuery = (link.text && link.text.toLowerCase().includes(query)) ||
                             (link.url && link.url.toLowerCase().includes(query)) ||
                             (link.group && link.group.toLowerCase().includes(query));
        if (!matchesQuery) return false;
      }

      // Chip filter
      if (scannerFilter === 'cached') return link.state === TorBoxConstants.STATES.CACHED;
      if (scannerFilter === 'torrents') return link.type === 'torrent' || link.url.startsWith('magnet:');
      if (scannerFilter === 'hosters') return link.type === 'webdl';
      return true;
    });

    if (filtered.length === 0) {
      pageLinksList.innerHTML = `<div class="empty-state"><p>No links matching current filter.</p></div>`;
      return;
    }

    // Group by section/heading
    const groups = {};
    filtered.forEach(link => {
      const g = link.group || 'Page Links';
      if (!groups[g]) groups[g] = [];
      groups[g].push(link);
    });

    let html = '';
    Object.keys(groups).forEach(groupName => {
      html += `<div class="link-group-header">${escapeHtml(groupName)}</div>`;

      groups[groupName].forEach(link => {
        const isCached = link.state === TorBoxConstants.STATES.CACHED;
        const isChecking = link.state === TorBoxConstants.STATES.CHECKING;
        const isError = link.state === TorBoxConstants.STATES.ERROR;

        let statusBadgeClass = 'not-cached';
        let statusText = '⚪ Not cached';
        if (isCached) { statusBadgeClass = 'cached'; statusText = '🟢 Cached'; }
        else if (isChecking) { statusBadgeClass = 'checking'; statusText = '⏳ Checking'; }
        else if (isError) { statusBadgeClass = 'error'; statusText = '⚠️ Error'; }

        const domain = TorBoxUtils.getHostname(link.url) || 'link';

        html += `
          <div class="link-card" data-url="${escapeHtml(link.url)}">
            <div class="link-title-row">
              <span class="link-name" title="${escapeHtml(link.url)}">${escapeHtml(link.text || link.url)}</span>
              <span class="link-type-pill">${escapeHtml(link.type || domain)}</span>
            </div>
            <div class="link-actions-row">
              <div class="link-status-badge ${statusBadgeClass}">${statusText}</div>
              <div class="card-action-btns">
                ${isCached ? `
                  <button class="mini-btn dl btn-download-link" data-url="${escapeHtml(link.url)}" title="Instant Direct Download">
                    ⚡ DL
                  </button>
                ` : `
                  <button class="mini-btn cloud btn-add-cloud" data-url="${escapeHtml(link.url)}" title="Add to TorBox Queue">
                    ☁️ To TB
                  </button>
                `}
                <button class="mini-btn copy btn-copy-link" data-url="${escapeHtml(link.url)}" title="Copy Link">
                  📋
                </button>
              </div>
            </div>
          </div>
        `;
      });
    });

    pageLinksList.innerHTML = html;
  }

  // Scanner Search & Filter Event Handlers
  linkSearchInput.addEventListener('input', renderScannerList);
  rescanPageBtn.addEventListener('click', forceScanPage);

  scannerChips.forEach(chip => {
    chip.addEventListener('click', () => {
      scannerChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      scannerFilter = chip.dataset.filter;
      renderScannerList();
    });
  });

  // Helper to trigger download in page context so IDM / external download managers can intercept it
  function triggerDownloadUrl(downloadUrl, engine = 'idm') {
    if (!downloadUrl) return;

    if (engine !== 'browser') {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs.length > 0 && tabs[0].id && tabs[0].url && !tabs[0].url.startsWith('chrome://') && !tabs[0].url.startsWith('edge://') && !tabs[0].url.startsWith('about:')) {
          chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            func: (url) => {
              const a = document.createElement('a');
              a.href = url;
              a.setAttribute('download', '');
              a.style.display = 'none';
              document.body.appendChild(a);
              a.click();
              setTimeout(() => a.remove(), 1500);
            },
            args: [downloadUrl]
          }).catch(() => {
            chrome.runtime.sendMessage({ action: TorBoxConstants.MESSAGES.START_NATIVE_DOWNLOAD, url: downloadUrl });
          });
        } else {
          // Fallback for restricted tabs
          chrome.runtime.sendMessage({ action: TorBoxConstants.MESSAGES.START_NATIVE_DOWNLOAD, url: downloadUrl });
        }
      });
    }
  }

  // Link Action Delegation
  pageLinksList.addEventListener('click', async (e) => {
    const dlBtn = e.target.closest('.btn-download-link');
    const cloudBtn = e.target.closest('.btn-add-cloud');
    const copyBtn = e.target.closest('.btn-copy-link');

    if (dlBtn) {
      const url = dlBtn.dataset.url;
      dlBtn.textContent = '⏳ ...';
      chrome.runtime.sendMessage({ action: TorBoxConstants.MESSAGES.DOWNLOAD_CACHED, url }, (res) => {
        if (res && res.success && res.downloadUrl) {
          dlBtn.textContent = '✔️ Started';
          triggerDownloadUrl(res.downloadUrl, res.engine);
        } else {
          dlBtn.textContent = '⚠️ Failed';
        }
      });
    } else if (cloudBtn) {
      const url = cloudBtn.dataset.url;
      cloudBtn.textContent = '⏳ ...';
      const isMagnet = url.startsWith('magnet:?');
      const actionMsg = isMagnet ? TorBoxConstants.MESSAGES.CREATE_TORRENT : TorBoxConstants.MESSAGES.CREATE_WEBDL;

      chrome.runtime.sendMessage({ action: actionMsg, url }, (res) => {
        if (res && res.success) {
          cloudBtn.textContent = '✔️ Added';
        } else {
          cloudBtn.textContent = '⚠️ Failed';
        }
      });
    } else if (copyBtn) {
      const url = copyBtn.dataset.url;
      await navigator.clipboard.writeText(url);
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = '📋'; }, 1500);
    }
  });

  // Batch Download Cached
  batchDownloadCachedBtn.addEventListener('click', () => {
    const cachedLinks = pageLinksCache.filter(l => l.state === TorBoxConstants.STATES.CACHED);
    if (cachedLinks.length === 0) return;

    batchDownloadCachedBtn.textContent = '⏳ Starting batch...';
    cachedLinks.forEach((link, idx) => {
      setTimeout(() => {
        chrome.runtime.sendMessage({ action: TorBoxConstants.MESSAGES.DOWNLOAD_CACHED, url: link.url }, (res) => {
          if (res && res.success && res.downloadUrl) {
            triggerDownloadUrl(res.downloadUrl, res.engine);
          }
        });
      }, idx * 400);
    });

    setTimeout(() => {
      batchDownloadCachedBtn.textContent = '✔️ All Started!';
      setTimeout(() => {
        batchDownloadCachedBtn.innerHTML = `⚡ Download All Cached (<span id="batchCachedCount">${cachedLinks.length}</span>)`;
      }, 2000);
    }, cachedLinks.length * 400 + 500);
  });

  // Batch Add to Cloud
  batchAddCloudBtn.addEventListener('click', () => {
    const uncachedLinks = pageLinksCache.filter(l => l.state !== TorBoxConstants.STATES.CACHED);
    if (uncachedLinks.length === 0) return;

    batchAddCloudBtn.textContent = '⏳ Adding batch...';
    uncachedLinks.forEach((link, idx) => {
      setTimeout(() => {
        const isMagnet = link.url.startsWith('magnet:?');
        const actionMsg = isMagnet ? TorBoxConstants.MESSAGES.CREATE_TORRENT : TorBoxConstants.MESSAGES.CREATE_WEBDL;
        chrome.runtime.sendMessage({ action: actionMsg, url: link.url });
      }, idx * 300);
    });

    setTimeout(() => {
      batchAddCloudBtn.textContent = '✔️ Added to TorBox!';
      setTimeout(() => {
        batchAddCloudBtn.innerHTML = '<span>Add All to TorBox</span>';
      }, 2000);
    }, uncachedLinks.length * 300 + 500);
  });

  // 5. Quick Debrid Controller
  debridCheckBtn.addEventListener('click', async () => {
    const rawUrl = (debridInput.value || '').trim();
    if (!rawUrl) {
      debridResultBox.style.display = 'block';
      debridResultBox.innerHTML = `<span style="color:var(--ruby); font-size:11px;">Please enter a URL or Magnet URI.</span>`;
      return;
    }

    debridCheckBtn.disabled = true;
    debridCheckBtn.innerHTML = `<span>⏳ Checking TorBox Cache...</span>`;
    debridResultBox.style.display = 'block';
    debridResultBox.innerHTML = `<div class="loading-spinner-box" style="padding:10px;"><div class="spinner"></div><span>Querying TorBox API...</span></div>`;

    chrome.runtime.sendMessage({
      action: TorBoxConstants.MESSAGES.CHECK_CACHE,
      urls: [rawUrl]
    }, (res) => {
      debridCheckBtn.disabled = false;
      debridCheckBtn.innerHTML = `
        <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clip-rule="evenodd"/></svg>
        <span>Instant Debrid & Download</span>
      `;

      const results = (res && res.results) ? res.results : {};
      const state = results[rawUrl] || TorBoxConstants.STATES.NOT_CACHED;
      const isCached = state === TorBoxConstants.STATES.CACHED;

      debridResultBox.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <span style="font-size:12px; font-weight:700; color:var(--text-main);">${isCached ? '🟢 Instant Cache Available' : '⚪ Not in Cache'}</span>
          <span class="user-tier-badge" style="background:${isCached ? 'var(--emerald)' : 'var(--indigo)'}">${isCached ? 'CACHED' : 'QUEUE'}</span>
        </div>
        <div style="font-size:11px; color:var(--text-muted); word-break:break-all;">${escapeHtml(rawUrl.substring(0, 100))}</div>
        <div style="display:flex; gap:6px; margin-top:4px;">
          ${isCached ? `
            <button id="debridInstantDlBtn" class="btn btn-emerald" style="width:100%; padding:6px 10px;">
              ⚡ Direct Download (CDN)
            </button>
          ` : `
            <button id="debridQueueBtn" class="btn btn-indigo" style="width:100%; padding:6px 10px;">
              ☁️ Add to Cloud Download Queue
            </button>
          `}
        </div>
      `;

      const instantDl = document.getElementById('debridInstantDlBtn');
      if (instantDl) {
        instantDl.addEventListener('click', () => {
          instantDl.textContent = '⏳ Starting...';
          chrome.runtime.sendMessage({ action: TorBoxConstants.MESSAGES.DOWNLOAD_CACHED, url: rawUrl }, (dlRes) => {
            if (dlRes && dlRes.success && dlRes.downloadUrl) {
              instantDl.textContent = '✔️ Download Started!';
              triggerDownloadUrl(dlRes.downloadUrl, dlRes.engine);
            } else {
              instantDl.textContent = '⚠️ Error Starting Download';
            }
          });
        });
      }

      const queueBtn = document.getElementById('debridQueueBtn');
      if (queueBtn) {
        queueBtn.addEventListener('click', () => {
          queueBtn.textContent = '⏳ Adding...';
          const isMagnet = rawUrl.startsWith('magnet:?');
          const msg = isMagnet ? TorBoxConstants.MESSAGES.CREATE_TORRENT : TorBoxConstants.MESSAGES.CREATE_WEBDL;
          chrome.runtime.sendMessage({ action: msg, url: rawUrl }, (qRes) => {
            if (qRes && qRes.success) {
              queueBtn.textContent = '✔️ Added to TorBox!';
            } else {
              queueBtn.textContent = '⚠️ Failed to Add';
            }
          });
        });
      }
    });
  });

  // 6. Cloud Downloads Controller
  function fetchDownloads() {
    chrome.runtime.sendMessage({ action: TorBoxConstants.MESSAGES.GET_ACTIVE_DOWNLOADS }, (res) => {
      if (!res || !res.success) {
        downloadsList.innerHTML = `<div class="empty-state"><p style="color:var(--ruby)">Failed to load downloads. Check API Key.</p></div>`;
        return;
      }

      downloadsCache = res.downloads || [];
      const activeCount = downloadsCache.filter(d => d.status !== 'completed' && d.status !== 'cached').length;

      if (activeCount > 0) {
        activeDlCountBadge.style.display = 'inline-block';
        activeDlCountBadge.textContent = activeCount;
      } else {
        activeDlCountBadge.style.display = 'none';
      }

      renderDownloadsList();
    });
  }

  function renderDownloadsList() {
    let filtered = downloadsCache.filter(dl => {
      const isDone = dl.status === 'completed' || dl.status === 'cached';
      if (dlFilter === 'active') return !isDone;
      if (dlFilter === 'completed') return isDone;
      return true;
    });

    if (filtered.length === 0) {
      downloadsList.innerHTML = `<div class="empty-state"><p>No ${dlFilter === 'all' ? '' : dlFilter} downloads found.</p></div>`;
      return;
    }

    filtered.sort((a, b) => b.id - a.id);

    let html = '';
    filtered.forEach(dl => {
      const isDone = dl.status === 'completed' || dl.status === 'cached';
      const progressPercent = Math.min(100, (dl.progress || 0) * 100).toFixed(1);
      const speedStr = dl.speed > 0 ? ` • ${TorBoxUtils.formatSpeed(dl.speed)}` : '';
      const sizeStr = dl.size > 0 ? TorBoxUtils.formatBytes(dl.size) : '';

      html += `
        <div class="download-item-card" data-id="${dl.id}" data-type="${dl.type}">
          <div class="dl-item-header">
            <span class="dl-item-name" title="${escapeHtml(dl.name)}">${escapeHtml(dl.name)}</span>
            <span class="link-type-pill">${escapeHtml(dl.type)}</span>
          </div>

          <div class="dl-item-progress-bar">
            <div class="dl-item-progress-fill" style="width: ${progressPercent}%"></div>
          </div>

          <div class="dl-item-meta-row">
            <span>${escapeHtml(dl.status)} • ${progressPercent}%${speedStr} ${sizeStr ? `(${sizeStr})` : ''}</span>
            <div class="dl-item-controls">
              ${isDone ? `
                <button class="mini-btn dl btn-trigger-dl" data-id="${dl.id}" data-type="${dl.type}" title="Direct Download to PC">
                  ⚡ DL
                </button>
              ` : ''}
              <button class="mini-btn copy btn-delete-dl" data-id="${dl.id}" data-type="${dl.type}" title="Delete Download" style="color:var(--ruby);">
                🗑️
              </button>
            </div>
          </div>
        </div>
      `;
    });

    downloadsList.innerHTML = html;
  }

  // Downloads Filter Chips
  dlFilterChips.forEach(chip => {
    chip.addEventListener('click', () => {
      dlFilterChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      dlFilter = chip.dataset.dlFilter;
      renderDownloadsList();
    });
  });

  refreshDownloadsBtn.addEventListener('click', () => {
    downloadsList.innerHTML = `<div class="loading-spinner-box"><div class="spinner"></div><span>Refreshing...</span></div>`;
    fetchDownloads();
  });

  // Downloads Actions Delegation
  downloadsList.addEventListener('click', (e) => {
    const dlBtn = e.target.closest('.btn-trigger-dl');
    const deleteBtn = e.target.closest('.btn-delete-dl');

    if (dlBtn) {
      const id = parseInt(dlBtn.dataset.id);
      const type = dlBtn.dataset.type;
      dlBtn.textContent = '⏳ ...';

      chrome.runtime.sendMessage({
        action: TorBoxConstants.MESSAGES.REQUEST_DOWNLOAD_BY_ID,
        id,
        type
      }, (res) => {
        if (res && res.success && res.downloadUrl) {
          dlBtn.textContent = '✔️ Started';
          triggerDownloadUrl(res.downloadUrl, res.engine);
        } else {
          dlBtn.textContent = '⚠️ Failed';
        }
      });
    } else if (deleteBtn) {
      const id = parseInt(deleteBtn.dataset.id);
      const type = deleteBtn.dataset.type;
      deleteBtn.textContent = '⏳';

      chrome.runtime.sendMessage({
        action: TorBoxConstants.MESSAGES.CONTROL_DOWNLOAD,
        id,
        type,
        operation: 'delete'
      }, (res) => {
        if (res && res.success) {
          const card = deleteBtn.closest('.download-item-card');
          if (card) card.remove();
        } else {
          deleteBtn.textContent = '⚠️';
        }
      });
    }
  });

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Initial Boot
  loadUserInfo();
  fetchPageLinks();

  // Polling loop for active tab
  pollInterval = setInterval(() => {
    if (currentTab === 'downloads') {
      fetchDownloads();
    } else if (currentTab === 'scanner') {
      fetchPageLinks();
    }
  }, 3500);
});
