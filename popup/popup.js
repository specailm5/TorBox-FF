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
  const versionTag = document.getElementById('versionTag');
  const copyAuthCodeBtn = document.getElementById('copyAuthCodeBtn');

  try {
    versionTag.textContent = `v${chrome.runtime.getManifest().version}`;
  } catch (e) {
    versionTag.textContent = 'Debrid manager';
  }

  // Scanner Tab Elements
  const countCachedEl = document.getElementById('countCached');
  const countNotCachedEl = document.getElementById('countNotCached');
  const countTotalEl = document.getElementById('countTotal');
  const linkSearchInput = document.getElementById('linkSearchInput');
  const rescanPageBtn = document.getElementById('rescanPageBtn');
  const excludeSiteBtn = document.getElementById('excludeSiteBtn');
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
      tabButtons.forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
        b.tabIndex = -1;
      });
      tabPanels.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      btn.tabIndex = 0;
      const tabId = btn.dataset.tab;
      currentTab = tabId;
      document.getElementById(`tab-${tabId}`).classList.add('active');

      if (tabId === 'downloads') {
        fetchDownloads();
      } else if (tabId === 'scanner') {
        fetchPageLinks();
        refreshSiteExclusion();
      }
    });
  });

  document.querySelector('.nav-tabs').addEventListener('keydown', (e) => {
    const navKeys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
    if (!navKeys.includes(e.key)) return;
    e.preventDefault();

    const tabs = Array.from(tabButtons);
    let index = tabs.indexOf(document.activeElement);
    if (index === -1) index = 0;
    if (e.key === 'ArrowRight') index = (index + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') index = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') index = 0;
    else index = tabs.length - 1;

    tabs[index].focus();
    tabs[index].click();
  });

  // 3. Load User Profile Info
  function loadUserInfo() {
    chrome.runtime.sendMessage({ action: TorBoxConstants.MESSAGES.GET_USER_INFO }, (res) => {
      if (res && res.success && res.user) {
        const u = res.user;
        userTierBadge.textContent = u.planBadge || 'USER';
        userTierBadge.className = 'user-tier-badge' + (u.plan > 0 ? ' is-paid' : '');

        if (u.bandwidthLimit > 0) {
          const usedStr = TorBoxUtils.formatBytes(u.bandwidthUsed, 1);
          const limitStr = TorBoxUtils.formatBytes(u.bandwidthLimit, 0);
          userQuota.textContent = `${usedStr} / ${limitStr}`;
        } else {
          userQuota.textContent = u.username || 'Active';
        }

        authBanner.hidden = true;
      } else {
        userTierBadge.textContent = 'Guest';
        userTierBadge.className = 'user-tier-badge is-guest';
        userQuota.textContent = 'Sign in';
        authBanner.hidden = false;
      }
    });
  }

  // 4. Device Code 1-Click Login Controller
  function buildVerificationUrl(data, code) {
    if (data.verification_url_complete) return data.verification_url_complete;
    const base = data.verification_url || data.friendly_verification_url || 'https://torbox.app/oauth/device';
    try {
      const url = new URL(base);
      if (code) url.searchParams.set('code', code);
      return url.toString();
    } catch (e) {
      return base;
    }
  }

  async function copyText(text) {
    if (!text) return false;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      try {
        const field = document.createElement('textarea');
        field.value = text;
        field.setAttribute('readonly', '');
        field.style.position = 'fixed';
        field.style.opacity = '0';
        document.body.appendChild(field);
        field.select();
        const copied = document.execCommand('copy');
        field.remove();
        return copied;
      } catch (fallbackError) {
        return false;
      }
    }
  }

  function setAuthStatus(text, state) {
    authStatusText.textContent = text;
    authStatusText.className = 'auth-status' + (state ? ` is-${state}` : '');
  }

  function closeAuthModal() {
    deviceAuthModal.hidden = true;
    if (authPollTimer) clearInterval(authPollTimer);
    authPollTimer = null;
    quickLoginBtn.focus();
  }

  copyAuthCodeBtn.addEventListener('click', async () => {
    const code = authCodeDisplay.textContent.trim();
    if (!code || code === '------') return;
    const copied = await copyText(code);
    setAuthStatus(copied ? 'Code copied to clipboard.' : 'Could not copy the code. Select it and copy manually.', copied ? 'success' : 'error');
  });

  quickLoginBtn.addEventListener('click', () => {
    quickLoginBtn.disabled = true;
    quickLoginBtn.textContent = 'Connecting…';

    chrome.runtime.sendMessage({ action: TorBoxConstants.MESSAGES.START_DEVICE_AUTH }, async (res) => {
      quickLoginBtn.disabled = false;
      quickLoginBtn.textContent = 'Sign in';

      if (!res || !res.success || !res.authData) {
        authBanner.querySelector('.auth-banner-text').textContent =
          (res && res.error) ? `Sign-in failed: ${res.error}` : 'Could not start sign-in. Check your connection and try again.';
        return;
      }

      const data = res.authData;
      const authCode = data.code || data.user_code || data.device_code || '------';
      const verifyUrl = buildVerificationUrl(data, authCode);
      const bannerText = authBanner.querySelector('.auth-banner-text');
      if (bannerText) {
        bannerText.textContent = 'Sign in to download cached files and manage your TorBox cloud.';
      }

      authCodeDisplay.textContent = authCode;
      authVerifyLink.href = verifyUrl;
      deviceAuthModal.hidden = false;
      closeAuthModalBtn.focus();
      setAuthStatus('Waiting for approval…');

      // Copy while the popup still has focus; opening the tab closes the popup.
      const copied = await copyText(authCode);
      setAuthStatus(
        copied ? 'Code copied. Finish signing in on the TorBox page.' : 'Copy the code below if the TorBox page does not fill it in.'
      );

      chrome.tabs.create({ url: verifyUrl });

      if (authPollTimer) clearInterval(authPollTimer);
      const pollIntervalMs = (data.interval || 5) * 1000;

      authPollTimer = setInterval(() => {
        chrome.runtime.sendMessage({
          action: TorBoxConstants.MESSAGES.CHECK_DEVICE_AUTH_TOKEN,
          deviceCode: data.device_code
        }, (tokenRes) => {
          if (tokenRes && tokenRes.success) {
            clearInterval(authPollTimer);
            authPollTimer = null;
            setAuthStatus('Connected. This window will close.', 'success');
            setTimeout(() => {
              deviceAuthModal.hidden = true;
              loadUserInfo();
              fetchPageLinks();
            }, 1200);
          }
        });
      }, pollIntervalMs);
    });
  });

  closeAuthModalBtn.addEventListener('click', closeAuthModal);

  document.addEventListener('keydown', (e) => {
    if (deviceAuthModal.hidden) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeAuthModal();
      return;
    }
    if (e.key !== 'Tab') return;

    const focusable = Array.from(deviceAuthModal.querySelectorAll('button, a[href]'))
      .filter(el => !el.disabled);
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  // Listen for storage changes (background login completion)
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.torboxApiKey && changes.torboxApiKey.newValue) {
      deviceAuthModal.hidden = true;
      if (authPollTimer) clearInterval(authPollTimer);
      authPollTimer = null;
      loadUserInfo();
      fetchPageLinks();
    }
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
          // On excluded sites the content script is never injected, so report the
          // exclusion accurately instead of showing a generic "no links" message.
          const domain = TorBoxUtils.normalizeDomain(activeTab.url || '');
          chrome.storage.local.get(['customExcludedDomains'], (stored) => {
            if (TorBoxUtils.isDomainExcluded(domain, stored.customExcludedDomains)) {
              pageLinksCache = [];
              renderScannerExcluded();
            } else {
              updateStatsCounters(0, 0, 0);
              renderScannerEmpty("No downloadable links detected on this page, or page scanning is restricted.");
            }
          });
          return;
        }

        if (res.excluded) {
          pageLinksCache = [];
          renderScannerExcluded();
          return;
        }

        pageLinksCache = res.links;
        renderScannerList();
      });
    });
  }

  function renderScannerExcluded() {
    updateStatsCounters(0, 0, 0);
    pageLinksList.innerHTML = `
      <div class="empty-state">
        <p>Scanning is turned off for this site.</p>
        <button id="includeSiteNowBtn" class="btn btn-secondary btn-small" type="button">
          Re-enable on this site
        </button>
      </div>
    `;
    const btn = document.getElementById('includeSiteNowBtn');
    if (btn) {
      btn.addEventListener('click', () => toggleSiteExclusion(false));
    }
  }

  function updateStatsCounters(cached, notCached, total) {
    countCachedEl.textContent = cached;
    countNotCachedEl.textContent = notCached;
    countTotalEl.textContent = total;
  }

  function renderScannerEmpty(message) {
    pageLinksList.innerHTML = `
      <div class="empty-state">
        <p>${escapeHtml(message)}</p>
        <button id="triggerScanNowBtn" class="btn btn-secondary btn-small" type="button">
          Scan this page again
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

  // 6b. Exclude This Site Controller
  function getActiveTabSite() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = (tabs && tabs.length > 0) ? tabs[0] : null;
        const domain = tab ? TorBoxUtils.normalizeDomain(tab.url || '') : '';
        resolve({ tab, domain });
      });
    });
  }

  // Inject the scanner into a tab on demand. Used when the user re-enables a site
  // that is currently excluded (and therefore has no content script injected).
  function injectScannerIntoTab(tabId, callback) {
    if (tabId === undefined || tabId === null || !chrome.scripting) {
      if (callback) callback();
      return;
    }

    chrome.scripting.executeScript({
      target: { tabId },
      func: () => Boolean(window.torBoxScanner)
    }, (results) => {
      const alreadyInjected = !chrome.runtime.lastError && results && results[0] && results[0].result;
      if (alreadyInjected) {
        if (callback) callback();
        return;
      }

      chrome.scripting.executeScript({
        target: { tabId },
        files: [
          'shared/constants.js',
          'shared/utils.js',
          'lib/md5.js',
          'content/ui.js',
          'content/scanner.js'
        ]
      }, () => {
        void chrome.runtime.lastError;
        chrome.scripting.insertCSS({
          target: { tabId },
          files: ['content/content.css']
        }, () => {
          void chrome.runtime.lastError;
          if (callback) callback();
        });
      });
    });
  }

  async function refreshSiteExclusion() {
    if (!excludeSiteBtn) return;
    const { domain } = await getActiveTabSite();

    if (!domain) {
      excludeSiteBtn.disabled = true;
      excludeSiteBtn.textContent = 'Exclude site';
      excludeSiteBtn.classList.remove('excluded');
      excludeSiteBtn.title = 'This page cannot be excluded';
      return;
    }

    excludeSiteBtn.disabled = false;
    const stored = await chrome.storage.local.get(['customExcludedDomains']);
    const isExcluded = TorBoxUtils.isDomainExcluded(domain, stored.customExcludedDomains);

    excludeSiteBtn.classList.toggle('excluded', isExcluded);
    excludeSiteBtn.textContent = isExcluded ? 'Re-enable site' : 'Exclude site';
    excludeSiteBtn.title = isExcluded
      ? `TorBox is disabled on ${domain}. Click to re-enable.`
      : `Stop scanning and hide the TorBox dock on ${domain}`;
  }

  async function toggleSiteExclusion(exclude) {
    if (!excludeSiteBtn) return;
    const { tab, domain } = await getActiveTabSite();
    if (!domain) return;

    excludeSiteBtn.disabled = true;
    excludeSiteBtn.textContent = 'Saving…';

    const stored = await chrome.storage.local.get(['customExcludedDomains']);
    const current = Array.isArray(stored.customExcludedDomains) ? stored.customExcludedDomains : [];

    let next;
    if (exclude) {
      next = current.some(d => TorBoxUtils.normalizeDomain(d) === domain) ? current : [...current, domain];
    } else {
      next = current.filter(d => TorBoxUtils.normalizeDomain(d) !== domain);
    }

    await chrome.storage.local.set({ customExcludedDomains: next });

    // Tell the live content script immediately; its own storage listener is the
    // fallback for tabs that cannot receive messages.
    if (tab && tab.id !== undefined) {
      try {
        chrome.tabs.sendMessage(tab.id, {
          action: exclude ? TorBoxConstants.MESSAGES.EXCLUDE_SITE : TorBoxConstants.MESSAGES.INCLUDE_SITE
        });
      } catch (e) {}
    }

    await refreshSiteExclusion();

    if (exclude) {
      pageLinksCache = [];
      renderScannerExcluded();
    } else if (tab && tab.id !== undefined) {
      // The site was excluded, so the content script is not present yet — inject it
      // now instead of asking the user to reload the page.
      injectScannerIntoTab(tab.id, () => setTimeout(fetchPageLinks, 600));
    } else {
      setTimeout(fetchPageLinks, 600);
    }
  }

  if (excludeSiteBtn) {
    excludeSiteBtn.addEventListener('click', async () => {
      const stored = await chrome.storage.local.get(['customExcludedDomains']);
      const { domain } = await getActiveTabSite();
      const isExcluded = TorBoxUtils.isDomainExcluded(domain, stored.customExcludedDomains);
      toggleSiteExclusion(!isExcluded);
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
      pageLinksList.innerHTML = `
        <div class="empty-state">
          <p>No links match this filter.</p>
          <button id="clearScannerFiltersBtn" class="btn btn-secondary btn-small" type="button">Clear filters</button>
        </div>
      `;
      const clearBtn = document.getElementById('clearScannerFiltersBtn');
      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          scannerFilter = 'all';
          linkSearchInput.value = '';
          scannerChips.forEach(c => c.classList.toggle('active', c.dataset.filter === 'all'));
          renderScannerList();
        });
      }
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
          <button class="link-group-header-btn" type="button" aria-expanded="${isOpen}">
            <span class="link-group-title" title="${escapeHtml(groupName)}">${escapeHtml(groupName)}</span>
            <span class="link-group-meta">
              ${gCachedCount > 0 ? `<span class="group-cached-badge">${gCachedCount} cached</span>` : ''}
              <span class="group-count-badge">${groupLinks.length}</span>
              <span class="link-group-chevron" aria-hidden="true">▼</span>
            </span>
          </button>
          <div class="link-group-body">
      `;

      groupLinks.forEach(link => {
        const isCached = link.state === TorBoxConstants.STATES.CACHED;
        const isChecking = link.state === TorBoxConstants.STATES.CHECKING;
        const isError = link.state === TorBoxConstants.STATES.ERROR;

        let statusBadgeClass = 'not-cached';
        let statusText = 'Not cached';
        if (isCached) { statusBadgeClass = 'cached'; statusText = 'Cached'; }
        else if (isChecking) { statusBadgeClass = 'checking'; statusText = 'Checking'; }
        else if (isError) { statusBadgeClass = 'error'; statusText = 'Error'; }

        const domain = TorBoxUtils.getHostname(link.url) || 'link';

        html += `
          <div class="link-card ${isCached ? 'is-cached' : ''}" data-url="${escapeHtml(link.url)}">
            <div class="link-title-row">
              <span class="link-name" title="${escapeHtml(link.url)}">${escapeHtml(link.text || link.url)}</span>
              <span class="link-type-pill">${escapeHtml(link.type || domain)}</span>
            </div>
            <div class="link-actions-row">
              <span class="link-status-badge ${statusBadgeClass}">${statusText}</span>
              <div class="card-action-btns">
                ${isCached ? `
                  <button class="mini-btn dl btn-download-link" type="button" data-url="${escapeHtml(link.url)}" title="Download this cached file">
                    Download
                  </button>
                ` : `
                  <button class="mini-btn cloud btn-add-cloud" type="button" data-url="${escapeHtml(link.url)}" title="Add to your TorBox cloud">
                    Add to TorBox
                  </button>
                `}
                <button class="mini-btn copy btn-copy-link" type="button" data-url="${escapeHtml(link.url)}" title="Copy link">
                  Copy
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
        const willOpen = !accordion.classList.contains('open');
        accordion.classList.toggle('open', willOpen);
        headerBtn.setAttribute('aria-expanded', String(willOpen));
        if (gName) {
          if (willOpen) openGroups.add(gName);
          else openGroups.delete(gName);
        }
      }
      return;
    }

    const dlBtn = e.target.closest('.btn-download-link');
    const cloudBtn = e.target.closest('.btn-add-cloud');
    const copyBtn = e.target.closest('.btn-copy-link');

    if (dlBtn) {
      const url = dlBtn.dataset.url;
      dlBtn.textContent = 'Starting…';
      dlBtn.disabled = true;
      chrome.runtime.sendMessage({ action: TorBoxConstants.MESSAGES.DOWNLOAD_CACHED, url }, (res) => {
        dlBtn.disabled = false;
        if (res && res.success && res.downloadUrl) {
          dlBtn.textContent = 'Started';
          triggerDownloadUrl(res.downloadUrl, res.engine);
        } else {
          dlBtn.textContent = 'Failed';
          dlBtn.classList.add('is-error');
          dlBtn.title = (res && res.error) ? res.error : 'Download failed';
        }
      });
    } else if (cloudBtn) {
      const url = cloudBtn.dataset.url;
      cloudBtn.textContent = 'Adding…';
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
          cloudBtn.textContent = 'Added';
          cloudBtn.classList.add('is-success');
          cloudBtn.title = res.detail || 'Added to TorBox';
        } else {
          cloudBtn.textContent = 'Failed';
          cloudBtn.classList.add('is-error');
          cloudBtn.title = (res && res.error) ? res.error : 'Failed to add';
        }
      });
    } else if (copyBtn) {
      const url = copyBtn.dataset.url;
      const copied = await copyText(url);
      copyBtn.textContent = copied ? 'Copied' : 'Failed';
      if (!copied) copyBtn.classList.add('is-error');
      setTimeout(() => {
        copyBtn.textContent = 'Copy';
        copyBtn.classList.remove('is-error');
      }, 1500);
    }
  });

  // 7. Quick Debrid Controller
  debridCheckBtn.addEventListener('click', async () => {
    const rawUrl = (debridInput.value || '').trim();
    if (!rawUrl) {
      debridResultBox.hidden = false;
      debridResultBox.innerHTML = `<p class="result-error">Enter a magnet, torrent, NZB, or hoster link first.</p>`;
      return;
    }

    debridCheckBtn.disabled = true;
    debridCheckBtn.textContent = 'Checking cache…';
    debridResultBox.hidden = false;
    debridResultBox.innerHTML = `<div class="loading-spinner-box" role="status"><div class="spinner" aria-hidden="true"></div><span>Checking TorBox cache…</span></div>`;

    const isMagnet = rawUrl.startsWith('magnet:?');

    chrome.runtime.sendMessage({
      action: TorBoxConstants.MESSAGES.CHECK_CACHE,
      urls: [rawUrl],
      listFiles: true
    }, (res) => {
      debridCheckBtn.disabled = false;
      debridCheckBtn.textContent = 'Check cache and download';

      const results = (res && res.results) ? res.results : {};
      const state = results[rawUrl] || TorBoxConstants.STATES.NOT_CACHED;
      const isCached = state === TorBoxConstants.STATES.CACHED;

      debridResultBox.innerHTML = `
        <div class="result-head">
          <span class="result-title ${isCached ? 'is-cached' : ''}">${isCached ? 'Available in cache' : 'Not in cache'}</span>
          <span class="user-tier-badge ${isCached ? 'is-paid' : ''}">${isCached ? 'Cached' : 'Queue'}</span>
        </div>
        <p class="result-url">${escapeHtml(rawUrl.substring(0, 100))}</p>
        <div class="result-actions">
          ${isCached ? `
            <button id="debridInstantDlBtn" class="btn btn-primary btn-block" type="button">Download now</button>
          ` : `
            <button id="debridQueueBtn" class="btn btn-secondary btn-block" type="button">Add to TorBox</button>
          `}
          ${isMagnet ? `
            <button id="debridConvertTorrentBtn" class="btn btn-secondary btn-block" type="button">Save as .torrent</button>
          ` : ''}
        </div>
      `;

      const instantDl = document.getElementById('debridInstantDlBtn');
      if (instantDl) {
        instantDl.addEventListener('click', () => {
          instantDl.disabled = true;
          instantDl.textContent = 'Starting…';
          chrome.runtime.sendMessage({ action: TorBoxConstants.MESSAGES.DOWNLOAD_CACHED, url: rawUrl }, (dlRes) => {
            instantDl.disabled = false;
            if (dlRes && dlRes.success && dlRes.downloadUrl) {
              instantDl.textContent = 'Download started';
              triggerDownloadUrl(dlRes.downloadUrl, dlRes.engine);
            } else {
              instantDl.textContent = 'Download failed';
              instantDl.classList.add('is-error');
            }
          });
        });
      }

      const convertBtn = document.getElementById('debridConvertTorrentBtn');
      if (convertBtn) {
        convertBtn.addEventListener('click', () => {
          convertBtn.disabled = true;
          convertBtn.textContent = 'Converting…';
          chrome.runtime.sendMessage({ action: TorBoxConstants.MESSAGES.MAGNET_TO_FILE, magnet: rawUrl }, (mRes) => {
            convertBtn.disabled = false;
            if (mRes && mRes.success && mRes.torrentData) {
              const name = TorBoxUtils.extractMagnetName(rawUrl) || 'download';
              const blobUrl = `data:application/x-bittorrent;base64,${btoa(unescape(encodeURIComponent(JSON.stringify(mRes.torrentData))))}`;
              chrome.runtime.sendMessage({
                action: TorBoxConstants.MESSAGES.START_NATIVE_DOWNLOAD,
                url: blobUrl,
                filename: `${name}.torrent`
              });
              convertBtn.textContent = 'Saved .torrent';
            } else {
              convertBtn.textContent = 'Conversion failed';
              convertBtn.classList.add('is-error');
            }
          });
        });
      }

      const queueBtn = document.getElementById('debridQueueBtn');
      if (queueBtn) {
        queueBtn.addEventListener('click', () => {
          queueBtn.textContent = 'Adding…';
          queueBtn.disabled = true;
          const isTorrent = rawUrl.toLowerCase().endsWith('.torrent') || rawUrl.toLowerCase().includes('.torrent?');
          const isUsenet = rawUrl.toLowerCase().endsWith('.nzb') || rawUrl.toLowerCase().includes('.nzb?');

          let msg = TorBoxConstants.MESSAGES.CREATE_WEBDL;
          if (isMagnet || isTorrent) msg = TorBoxConstants.MESSAGES.CREATE_TORRENT;
          else if (isUsenet) msg = TorBoxConstants.MESSAGES.CREATE_USENET;

          chrome.runtime.sendMessage({ action: msg, url: rawUrl }, (qRes) => {
            queueBtn.disabled = false;
            if (qRes && qRes.success) {
              queueBtn.textContent = 'Added to TorBox';
              queueBtn.classList.add('is-success');
            } else {
              queueBtn.textContent = 'Could not add to TorBox';
              queueBtn.classList.add('is-error');
              queueBtn.title = (qRes && qRes.error) ? qRes.error : 'Failed to add';
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
        downloadsList.innerHTML = `
          <div class="empty-state">
            <p>Could not load activity. Check your connection and try again.</p>
            <button id="retryDownloadsBtn" class="btn btn-secondary btn-small" type="button">Try again</button>
          </div>
        `;
        const retryBtn = document.getElementById('retryDownloadsBtn');
        if (retryBtn) retryBtn.addEventListener('click', fetchDownloads);
        return;
      }

      downloadsCache = res.downloads || [];
      const activeCount = downloadsCache.filter(d => d.status !== 'completed' && d.status !== 'cached').length;

      if (activeCount > 0) {
        activeDlCountBadge.hidden = false;
        activeDlCountBadge.textContent = activeCount;
      } else {
        activeDlCountBadge.hidden = true;
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
      const label = dlFilter === 'all'
        ? 'No TorBox activity yet. Add a link from the Scanner tab to get started.'
        : `No ${dlFilter} items right now.`;
      downloadsList.innerHTML = `
        <div class="empty-state">
          <p>${escapeHtml(label)}</p>
          ${dlFilter !== 'all' ? '<button id="clearDlFilterBtn" class="btn btn-secondary btn-small" type="button">Show all activity</button>' : ''}
        </div>
      `;
      const clearBtn = document.getElementById('clearDlFilterBtn');
      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          dlFilter = 'all';
          dlFilterChips.forEach(c => c.classList.toggle('active', c.dataset.dlFilter === 'all'));
          renderDownloadsList();
        });
      }
      return;
    }

    filtered.sort((a, b) => b.id - a.id);

    let html = '';
    filtered.forEach(dl => {
      const isDone = dl.status === 'completed' || dl.status === 'cached';
      const progressPercent = Math.min(100, (dl.progress || 0) * 100).toFixed(1);
      const speedStr = dl.speed > 0 ? ` · ${TorBoxUtils.formatSpeed(dl.speed)}` : '';
      const sizeStr = dl.size > 0 ? TorBoxUtils.formatBytes(dl.size) : '';
      const hasFiles = Array.isArray(dl.files) && dl.files.length > 1;
      const statusLabel = String(dl.status || 'unknown')
        .replace(/[_-]+/g, ' ')
        .replace(/^\w/, c => c.toUpperCase());

      html += `
        <div class="download-item-card" data-id="${dl.id}" data-type="${dl.type}">
          <div class="dl-item-header">
            <span class="dl-item-name" title="${escapeHtml(dl.name)}">${escapeHtml(dl.name)}</span>
            <span class="link-type-pill">${escapeHtml(dl.type)}</span>
          </div>

          <div class="dl-item-progress-bar" role="progressbar" aria-label="Download progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progressPercent}">
            <div class="dl-item-progress-fill" style="width: ${progressPercent}%"></div>
          </div>

          <div class="dl-item-meta-row">
            <span>${escapeHtml(statusLabel)} · ${progressPercent}%${speedStr} ${sizeStr ? `(${sizeStr})` : ''}</span>
            <div class="dl-item-controls">
              ${isDone ? `
                <button class="mini-btn dl btn-trigger-dl" type="button" data-id="${dl.id}" data-type="${dl.type}" title="Download the full item as a zip">
                  Download zip
                </button>
              ` : ''}
              <button class="mini-btn copy btn-delete-dl" type="button" data-id="${dl.id}" data-type="${dl.isQueued ? 'queued' : dl.type}" title="Delete this item">
                Delete
              </button>
            </div>
          </div>

          ${hasFiles ? `
            <div class="dl-files-container">
              <button class="dl-files-toggle" type="button" data-id="${dl.id}" data-count="${dl.files.length}" aria-expanded="false">
                View ${dl.files.length} files
              </button>
              <div class="dl-files-list" id="files-list-${dl.id}" hidden>
                ${dl.files.map(f => {
                  const fName = f.name || f.short_name || 'File';
                  const fSize = f.size ? TorBoxUtils.formatBytes(f.size) : '';
                  return `
                    <div class="dl-file-row">
                      <div class="dl-file-info">
                        <span class="dl-file-name" title="${escapeHtml(fName)}">${escapeHtml(fName)}</span>
                        <span class="dl-file-size">${fSize}</span>
                      </div>
                      <div class="dl-file-actions">
                        ${isDone ? `
                          <button class="mini-btn dl btn-file-dl" type="button" data-torrent-id="${dl.id}" data-type="${dl.type}" data-file-id="${f.id}" title="Download this file">
                            Get
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
    downloadsList.innerHTML = `<div class="loading-spinner-box" role="status"><div class="spinner" aria-hidden="true"></div><span>Refreshing activity…</span></div>`;
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
      const count = toggleFilesBtn.dataset.count || '';
      const listEl = document.getElementById(`files-list-${id}`);
      if (listEl) {
        const willShow = listEl.hidden;
        listEl.hidden = !willShow;
        toggleFilesBtn.setAttribute('aria-expanded', String(willShow));
        toggleFilesBtn.textContent = willShow ? `Hide ${count} files` : `View ${count} files`;
      }
    } else if (fileDlBtn) {
      const torrentId = parseInt(fileDlBtn.dataset.torrentId);
      const type = fileDlBtn.dataset.type;
      const fileId = parseInt(fileDlBtn.dataset.fileId);
      fileDlBtn.disabled = true;
      fileDlBtn.textContent = 'Starting…';

      chrome.runtime.sendMessage({
        action: TorBoxConstants.MESSAGES.REQUEST_DOWNLOAD_BY_ID,
        id: torrentId,
        type,
        fileId
      }, (res) => {
        fileDlBtn.disabled = false;
        if (res && res.success && res.downloadUrl) {
          fileDlBtn.textContent = 'Started';
          triggerDownloadUrl(res.downloadUrl, res.engine);
          setTimeout(() => { fileDlBtn.textContent = 'Get'; }, 2000);
        } else {
          fileDlBtn.textContent = 'Failed';
          fileDlBtn.classList.add('is-error');
        }
      });

    } else if (dlBtn) {
      const id = parseInt(dlBtn.dataset.id);
      const type = dlBtn.dataset.type;
      dlBtn.disabled = true;
      dlBtn.textContent = 'Starting…';

      chrome.runtime.sendMessage({
        action: TorBoxConstants.MESSAGES.REQUEST_DOWNLOAD_BY_ID,
        id,
        type
      }, (res) => {
        dlBtn.disabled = false;
        if (res && res.success && res.downloadUrl) {
          dlBtn.textContent = 'Started';
          triggerDownloadUrl(res.downloadUrl, res.engine);
        } else {
          dlBtn.textContent = 'Failed';
          dlBtn.classList.add('is-error');
        }
      });
    } else if (deleteBtn) {
      const id = parseInt(deleteBtn.dataset.id);
      const type = deleteBtn.dataset.type;
      deleteBtn.disabled = true;
      deleteBtn.textContent = 'Deleting…';

      chrome.runtime.sendMessage({
        action: TorBoxConstants.MESSAGES.CONTROL_DOWNLOAD,
        id,
        type,
        operation: 'delete'
      }, (res) => {
        deleteBtn.disabled = false;
        if (res && res.success) {
          const card = deleteBtn.closest('.download-item-card');
          if (card) card.remove();
        } else {
          deleteBtn.textContent = 'Failed';
          deleteBtn.classList.add('is-error');
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
  refreshSiteExclusion();

  // Keep the exclude button in sync when rules change elsewhere (options page)
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.customExcludedDomains) {
      refreshSiteExclusion();
    }
  });

  // Polling loop for active tab
  pollInterval = setInterval(() => {
    if (currentTab === 'downloads') {
      fetchDownloads();
    } else if (currentTab === 'scanner') {
      fetchPageLinks();
      refreshSiteExclusion();
    }
  }, 4000);
});
