/**
 * TorBox Popup Dashboard Controller
 * Full v2.1 feature set:
 * - Device code 1-click authorization
 * - Multi-file torrent file inspection & selective downloads
 * - Magnet to .torrent conversion & metadata inspector
 * - Queued downloads manager
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
  const authBanner = document.getElementById('authBanner');
  const quickLoginBtn = document.getElementById('quickLoginBtn');

  // Scanner Tab Elements
  const countCachedEl = document.getElementById('countCached');
  const countNotCachedEl = document.getElementById('countNotCached');
  const countTotalEl = document.getElementById('countTotal');
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

  const deviceAuthModal = document.getElementById('deviceAuthModal');
  const authCodeDisplay = document.getElementById('authCodeDisplay');
  const authVerifyLink = document.getElementById('authVerifyLink');
  const authStatusText = document.getElementById('authStatusText');
  const closeAuthModalBtn = document.getElementById('closeAuthModalBtn');

  // Internal State
  let currentTab = 'scanner';
  let scannerFilter = 'all';
  let dlFilter = 'all';
  let pageLinksCache = [];
  let downloadsCache = [];
  let openGroups = new Set();
  let authPollTimer = null;
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

        authBanner.style.display = 'none';
      } else {
        userTierBadge.textContent = 'GUEST';
        userTierBadge.style.background = '#ef4444';
        userQuota.textContent = 'Sign In';
        authBanner.style.display = 'block';
      }
    });
  }

  // 4. Device Code 1-Click Login Controller
  quickLoginBtn.addEventListener('click', () => {
    quickLoginBtn.disabled = true;
    quickLoginBtn.textContent = 'Connecting...';

    chrome.runtime.sendMessage({ action: TorBoxConstants.MESSAGES.START_DEVICE_AUTH }, (res) => {
      quickLoginBtn.disabled = false;
      quickLoginBtn.textContent = '⚡ 1-Click Sign In';

      if (res && res.success && res.authData) {
        const data = res.authData;
        authCodeDisplay.textContent = data.user_code || data.device_code || '------';
        authVerifyLink.href = data.verification_url || 'https://torbox.app/auth/device';
        authStatusText.textContent = '⏳ Waiting for browser confirmation...';

        deviceAuthModal.style.display = 'flex';
        chrome.tabs.create({ url: authVerifyLink.href });

        if (authPollTimer) clearInterval(authPollTimer);
        const pollIntervalMs = (data.interval || 5) * 1000;

        authPollTimer = setInterval(() => {
          chrome.runtime.sendMessage({
            action: TorBoxConstants.MESSAGES.CHECK_DEVICE_AUTH_TOKEN,
            deviceCode: data.device_code
          }, (tokenRes) => {
            if (tokenRes && tokenRes.success) {
              clearInterval(authPollTimer);
              authStatusText.textContent = '🟢 Connected successfully!';
              setTimeout(() => {
                deviceAuthModal.style.display = 'none';
                loadUserInfo();
                fetchPageLinks();
              }, 1200);
            }
          });
        }, pollIntervalMs);
      } else {
        alert("Failed to start device authentication. Please configure API key in Settings.");
      }
    });
  });

  closeAuthModalBtn.addEventListener('click', () => {
    deviceAuthModal.style.display = 'none';
    if (authPollTimer) clearInterval(authPollTimer);
  });



  // 6. Scanner Tab Controller
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
      if (query) {
        const matchesQuery = (link.text && link.text.toLowerCase().includes(query)) ||
                             (link.url && link.url.toLowerCase().includes(query)) ||
                             (link.group && link.group.toLowerCase().includes(query));
        if (!matchesQuery) return false;
      }

      if (scannerFilter === 'cached') return link.state === TorBoxConstants.STATES.CACHED;
      if (scannerFilter === 'torrents') return link.type === 'torrent' || link.url.startsWith('magnet:');
      if (scannerFilter === 'hosters') return link.type === 'webdl';
      return true;
    });

    if (filtered.length === 0) {
      pageLinksList.innerHTML = `<div class="empty-state"><p>No links matching current filter.</p></div>`;
      return;
    }

    // Group links by game / article title
    const groups = {};
    filtered.forEach(link => {
      let g = (link.group && link.group.trim()) || 'Page Links';
      if (g.length < 2 || !/[a-zA-Z0-9]/.test(g)) {
        g = 'Page Links';
      }
      if (!groups[g]) groups[g] = [];
      groups[g].push(link);
    });

    // Helper for link sorting: cached first, then checking, then uncached, then errors
    function getLinkPriority(l) {
      if (l.state === TorBoxConstants.STATES.CACHED) return 1;
      if (l.state === TorBoxConstants.STATES.CHECKING) return 2;
      if (l.state === TorBoxConstants.STATES.NOT_CACHED) return 3;
      if (l.state === TorBoxConstants.STATES.ERROR) return 4;
      return 5;
    }

    // 1. Sort links within each group (CACHED FIRST)
    Object.keys(groups).forEach(g => {
      groups[g].sort((a, b) => getLinkPriority(a) - getLinkPriority(b));
    });

    // 2. Sort groups so groups with cached links appear first
    const sortedGroupNames = Object.keys(groups)
      .filter(g => g && g.trim().length >= 2 && groups[g].length > 0)
      .sort((a, b) => {
        const getGroupScore = (gName) => {
          const gLinks = groups[gName] || [];
          const hasCached = gLinks.some(l => l.state === TorBoxConstants.STATES.CACHED);
          if (hasCached) return 2;
          const hasChecking = gLinks.some(l => l.state === TorBoxConstants.STATES.CHECKING);
          if (hasChecking) return 1;
          return 0;
        };
        return getGroupScore(b) - getGroupScore(a);
      });

    const currentScroll = pageLinksList.scrollTop;
    let html = '';
    sortedGroupNames.forEach((groupName) => {
      const groupLinks = groups[groupName];
      const gCachedLinks = groupLinks.filter(l => l.state === TorBoxConstants.STATES.CACHED);
      const gCachedCount = gCachedLinks.length;
      const isOpen = openGroups.has(groupName);

      html += `
        <div class="link-group-accordion ${isOpen ? 'open' : ''} ${gCachedCount > 0 ? 'has-cached' : ''}" data-group="${escapeHtml(groupName)}">
          <div class="link-group-header-btn" role="button" tabindex="0">
            <span class="link-group-title" title="${escapeHtml(groupName)}">🎮 ${escapeHtml(groupName)}</span>
            <div class="link-group-meta">
              ${gCachedCount > 0 ? `<span class="group-cached-badge">🟢 ${gCachedCount} cached</span>` : ''}
              <span class="group-count-badge">${groupLinks.length}</span>
              <span class="link-group-chevron">▼</span>
            </div>
          </div>
          <div class="link-group-body">
      `;

      groupLinks.forEach(link => {
        const isCached = link.state === TorBoxConstants.STATES.CACHED;
        const isChecking = link.state === TorBoxConstants.STATES.CHECKING;
        const isError = link.state === TorBoxConstants.STATES.ERROR;

        let statusBadgeClass = 'not-cached';
        let statusText = '⚪ Not cached';
        if (isCached) { statusBadgeClass = 'cached'; statusText = '🟢 Cached'; }
        else if (isChecking) { statusBadgeClass = 'checking'; statusText = '⏳ Checking'; }
        else if (isError) { statusBadgeClass = 'error'; statusText = '⚠️ Error'; }

        const domain = TorBoxUtils.getHostname(link.url) || 'link';

        const cardStyle = isCached ? 'border-color: rgba(16, 185, 129, 0.35); background: rgba(16, 185, 129, 0.05);' : '';

        html += `
          <div class="link-card" data-url="${escapeHtml(link.url)}" style="${cardStyle}">
            <div class="link-title-row">
              <span class="link-name" title="${escapeHtml(link.url)}" style="${isCached ? 'color: #34d399; font-weight:600;' : ''}">${escapeHtml(link.text || link.url)}</span>
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

      html += `
          </div>
        </div>
      `;
    });

    pageLinksList.innerHTML = html;
    pageLinksList.scrollTop = currentScroll;
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
          chrome.runtime.sendMessage({ action: TorBoxConstants.MESSAGES.START_NATIVE_DOWNLOAD, url: downloadUrl });
        }
      });
    }
  }

  // Link Action Delegation & Accordion Toggle
  pageLinksList.addEventListener('click', async (e) => {
    const headerBtn = e.target.closest('.link-group-header-btn');
    if (headerBtn) {
      const accordion = headerBtn.closest('.link-group-accordion');
      if (accordion) {
        const gName = accordion.dataset.group;
        if (accordion.classList.contains('open')) {
          accordion.classList.remove('open');
          if (gName) openGroups.delete(gName);
        } else {
          accordion.classList.add('open');
          if (gName) openGroups.add(gName);
        }
      }
      return;
    }

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
      cloudBtn.disabled = true;
      const isMagnet = url.startsWith('magnet:?');
      const isTorrent = url.toLowerCase().endsWith('.torrent') || url.toLowerCase().includes('.torrent?');
      const isUsenet = url.toLowerCase().endsWith('.nzb') || url.toLowerCase().includes('.nzb?');

      let actionMsg = TorBoxConstants.MESSAGES.CREATE_WEBDL;
      if (isMagnet || isTorrent) actionMsg = TorBoxConstants.MESSAGES.CREATE_TORRENT;
      else if (isUsenet) actionMsg = TorBoxConstants.MESSAGES.CREATE_USENET;

      chrome.runtime.sendMessage({ action: actionMsg, url }, (res) => {
        cloudBtn.disabled = false;
        if (res && res.success) {
          cloudBtn.textContent = '✔️ Added';
          cloudBtn.style.background = 'var(--emerald)';
          cloudBtn.title = res.detail || 'Added to TorBox!';
        } else {
          cloudBtn.textContent = '⚠️ Failed';
          cloudBtn.style.background = 'var(--ruby)';
          cloudBtn.title = (res && res.error) ? res.error : 'Failed to add';
        }
      });
    } else if (copyBtn) {
      const url = copyBtn.dataset.url;
      await navigator.clipboard.writeText(url);
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = '📋'; }, 1500);
    }
  });

  // 7. Quick Debrid Controller
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

    const isMagnet = rawUrl.startsWith('magnet:?');
    const isMedia = TorBoxUtils.isVideoOrAudio(rawUrl);

    chrome.runtime.sendMessage({
      action: TorBoxConstants.MESSAGES.CHECK_CACHE,
      urls: [rawUrl],
      listFiles: true
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
        
        <div style="display:grid; grid-template-columns:1fr; gap:6px; margin-top:6px;">
          ${isCached ? `
            <button id="debridInstantDlBtn" class="btn btn-emerald" style="padding:6px 10px; font-size:11px;">
              ⚡ Direct Download
            </button>
          ` : `
            <button id="debridQueueBtn" class="btn btn-indigo" style="padding:6px 10px; font-size:11px;">
              ☁️ Add to TorBox Queue
            </button>
          `}
          ${isMagnet ? `
            <button id="debridConvertTorrentBtn" class="btn btn-secondary" style="padding:6px 10px; font-size:11px;">
              💾 Save as .torrent File
            </button>
          ` : ''}
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

      const convertBtn = document.getElementById('debridConvertTorrentBtn');
      if (convertBtn) {
        convertBtn.addEventListener('click', () => {
          convertBtn.textContent = '⏳ Converting...';
          chrome.runtime.sendMessage({ action: TorBoxConstants.MESSAGES.MAGNET_TO_FILE, magnet: rawUrl }, (mRes) => {
            if (mRes && mRes.success && mRes.torrentData) {
              const name = TorBoxUtils.extractMagnetName(rawUrl) || 'download';
              const blobUrl = `data:application/x-bittorrent;base64,${btoa(unescape(encodeURIComponent(JSON.stringify(mRes.torrentData))))}`;
              chrome.runtime.sendMessage({
                action: TorBoxConstants.MESSAGES.START_NATIVE_DOWNLOAD,
                url: blobUrl,
                filename: `${name}.torrent`
              });
              convertBtn.textContent = '✔️ Saved .torrent!';
            } else {
              convertBtn.textContent = '⚠️ Conversion Failed';
            }
          });
        });
      }

      const queueBtn = document.getElementById('debridQueueBtn');
      if (queueBtn) {
        queueBtn.addEventListener('click', () => {
          queueBtn.textContent = '⏳ Adding...';
          queueBtn.disabled = true;
          const isMagnet = rawUrl.startsWith('magnet:?');
          const isTorrent = rawUrl.toLowerCase().endsWith('.torrent') || rawUrl.toLowerCase().includes('.torrent?');
          const isUsenet = rawUrl.toLowerCase().endsWith('.nzb') || rawUrl.toLowerCase().includes('.nzb?');

          let msg = TorBoxConstants.MESSAGES.CREATE_WEBDL;
          if (isMagnet || isTorrent) msg = TorBoxConstants.MESSAGES.CREATE_TORRENT;
          else if (isUsenet) msg = TorBoxConstants.MESSAGES.CREATE_USENET;

          chrome.runtime.sendMessage({ action: msg, url: rawUrl }, (qRes) => {
            queueBtn.disabled = false;
            if (qRes && qRes.success) {
              queueBtn.textContent = '✔️ Added to TorBox!';
              queueBtn.style.background = 'var(--emerald)';
            } else {
              queueBtn.textContent = '⚠️ ' + ((qRes && qRes.error) ? qRes.error.substring(0, 30) : 'Failed to Add');
              queueBtn.style.background = 'var(--ruby)';
            }
          });
        });
      }
    });
  });

  // 8. Cloud Downloads Controller (Multi-File Explorer)
  function fetchDownloads() {
    chrome.runtime.sendMessage({ action: TorBoxConstants.MESSAGES.GET_ACTIVE_DOWNLOADS }, (res) => {
      if (!res || !res.success) {
        downloadsList.innerHTML = `<div class="empty-state"><p style="color:var(--ruby)">Failed to load downloads. Check connection.</p></div>`;
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
      if (dlFilter === 'active') return !isDone && !dl.isQueued;
      if (dlFilter === 'queued') return dl.isQueued;
      if (dlFilter === 'completed') return isDone;
      return true;
    });

    if (filtered.length === 0) {
      downloadsList.innerHTML = `<div class="empty-state"><p>No ${dlFilter === 'all' ? '' : dlFilter} items found.</p></div>`;
      return;
    }

    filtered.sort((a, b) => b.id - a.id);

    let html = '';
    filtered.forEach(dl => {
      const isDone = dl.status === 'completed' || dl.status === 'cached';
      const progressPercent = Math.min(100, (dl.progress || 0) * 100).toFixed(1);
      const speedStr = dl.speed > 0 ? ` • ${TorBoxUtils.formatSpeed(dl.speed)}` : '';
      const sizeStr = dl.size > 0 ? TorBoxUtils.formatBytes(dl.size) : '';
      const hasFiles = Array.isArray(dl.files) && dl.files.length > 1;

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
                <button class="mini-btn dl btn-trigger-dl" data-id="${dl.id}" data-type="${dl.type}" title="Download Full Zip to PC">
                  ⚡ Zip
                </button>
              ` : ''}
              <button class="mini-btn copy btn-delete-dl" data-id="${dl.id}" data-type="${dl.isQueued ? 'queued' : dl.type}" title="Delete Item" style="color:var(--ruby);">
                🗑️
              </button>
            </div>
          </div>

          ${hasFiles ? `
            <div class="dl-files-container" style="margin-top:4px;">
              <button class="dl-files-toggle" data-id="${dl.id}">
                <span>📂 View ${dl.files.length} individual files</span>
              </button>
              <div class="dl-files-list" id="files-list-${dl.id}" style="display:none; margin-top:4px;">
                ${dl.files.map(f => {
                  const fName = f.name || f.short_name || 'File';
                  const isFileMedia = TorBoxUtils.isVideoOrAudio(fName);
                  const fSize = f.size ? TorBoxUtils.formatBytes(f.size) : '';
                  return `
                    <div class="dl-file-row">
                      <div class="dl-file-info">
                        <span class="dl-file-name" title="${escapeHtml(fName)}">${escapeHtml(fName)}</span>
                        <span class="dl-file-size">${fSize}</span>
                      </div>
                      <div class="dl-file-actions">
                        ${isDone ? `
                          <button class="mini-btn dl btn-file-dl" data-torrent-id="${dl.id}" data-type="${dl.type}" data-file-id="${f.id}" title="Download this file">
                            ⚡
                          </button>
                        ` : ''}
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          ` : ''}
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

  // Downloads Actions Delegation (Zip, Single Files, Delete)
  downloadsList.addEventListener('click', (e) => {
    const dlBtn = e.target.closest('.btn-trigger-dl');
    const deleteBtn = e.target.closest('.btn-delete-dl');
    const toggleFilesBtn = e.target.closest('.dl-files-toggle');
    const fileDlBtn = e.target.closest('.btn-file-dl');

    if (toggleFilesBtn) {
      const id = toggleFilesBtn.dataset.id;
      const listEl = document.getElementById(`files-list-${id}`);
      if (listEl) {
        const isHidden = listEl.style.display === 'none';
        listEl.style.display = isHidden ? 'flex' : 'none';
        toggleFilesBtn.innerHTML = isHidden ? `<span>▲ Hide files</span>` : `<span>📂 View individual files</span>`;
      }
    } else if (fileDlBtn) {
      const torrentId = parseInt(fileDlBtn.dataset.torrentId);
      const type = fileDlBtn.dataset.type;
      const fileId = parseInt(fileDlBtn.dataset.fileId);
      fileDlBtn.textContent = '⏳';

      chrome.runtime.sendMessage({
        action: TorBoxConstants.MESSAGES.REQUEST_DOWNLOAD_BY_ID,
        id: torrentId,
        type,
        fileId
      }, (res) => {
        if (res && res.success && res.downloadUrl) {
          fileDlBtn.textContent = '✔️';
          triggerDownloadUrl(res.downloadUrl, res.engine);
          setTimeout(() => { fileDlBtn.textContent = '⚡'; }, 2000);
        } else {
          fileDlBtn.textContent = '⚠️';
        }
      });

    } else if (dlBtn) {
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
  }, 4000);
});
