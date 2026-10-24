/**
 * TorBox Options Page Controller
 * Handles account credentials, 1-click device auth, preferences, cloud integrations, and hosters directory.
 */

document.addEventListener('DOMContentLoaded', () => {
  // Sidebar Navigation
  const navItems = document.querySelectorAll('.nav-item');
  const settingsSections = document.querySelectorAll('.settings-section');

  // Device Auth Elements
  const optDeviceAuthBtn = document.getElementById('optDeviceAuthBtn');
  const optAuthCodeContainer = document.getElementById('optAuthCodeContainer');
  const optAuthCodeDisplay = document.getElementById('optAuthCodeDisplay');
  const optAuthStatusText = document.getElementById('optAuthStatusText');
  const optCopyAuthCodeBtn = document.getElementById('optCopyAuthCodeBtn');
  const optAuthVerifyLink = document.getElementById('optAuthVerifyLink');
  const optSigninStatus = document.getElementById('optSigninStatus');
  const optionsVersionTag = document.getElementById('optionsVersionTag');

  try {
    optionsVersionTag.textContent = `v${chrome.runtime.getManifest().version}`;
  } catch (e) {
    optionsVersionTag.textContent = 'Debrid manager';
  }

  // Account Elements
  const apiKeyInput = document.getElementById('apiKey');
  const toggleVisibleBtn = document.getElementById('toggleVisibleBtn');
  const saveKeyBtn = document.getElementById('saveKeyBtn');
  const testKeyBtn = document.getElementById('testKeyBtn');
  const removeKeyBtn = document.getElementById('removeKeyBtn');
  const apiStatusMsg = document.getElementById('apiStatusMsg');

  // Overview Elements
  const accountOverviewCard = document.getElementById('accountOverviewCard');
  const overviewTierBadge = document.getElementById('overviewTierBadge');
  const overviewEmail = document.getElementById('overviewEmail');
  const overviewBandwidth = document.getElementById('overviewBandwidth');
  const overviewExpires = document.getElementById('overviewExpires');
  const overviewTotalDl = document.getElementById('overviewTotalDl');

  // Preferences Elements
  const autoScanToggle = document.getElementById('autoScanToggle');
  const scanTextLinksToggle = document.getElementById('scanTextLinksToggle');
  const showFloatingDockToggle = document.getElementById('showFloatingDockToggle');
  const notificationsToggle = document.getElementById('notificationsToggle');
  const backgroundCompletionAlertsToggle = document.getElementById('backgroundCompletionAlertsToggle');
  const skipSaveDialogToggle = document.getElementById('skipSaveDialogToggle');
  const downloadEngineSelect = document.getElementById('downloadEngineSelect');
  const savePreferencesBtn = document.getElementById('savePreferencesBtn');
  const prefsStatusMsg = document.getElementById('prefsStatusMsg');

  // Hosters Explorer Elements
  const hosterSearchInput = document.getElementById('hosterSearchInput');
  const hostersTableBody = document.getElementById('hostersTableBody');
  const hostersCount = document.getElementById('hostersCount');

  // Domain Rules Elements
  const excludedDomainsTextarea = document.getElementById('excludedDomainsTextarea');
  const saveRulesBtn = document.getElementById('saveRulesBtn');
  const rulesStatusMsg = document.getElementById('rulesStatusMsg');

  let hostersCache = [];
  let deviceAuthPollTimer = null;

  // 1. Navigation Controller
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      navItems.forEach(n => {
        n.classList.remove('active');
        n.removeAttribute('aria-current');
      });
      settingsSections.forEach(s => s.classList.remove('active'));

      item.classList.add('active');
      item.setAttribute('aria-current', 'page');
      const targetSection = item.dataset.section;
      document.getElementById(`section-${targetSection}`).classList.add('active');
    });
  });

  // 2. Load Stored Settings
  function loadSettings() {
    chrome.storage.local.get([
      'torboxApiKey',
      'autoScan',
      'scanTextLinks',
      'showFloatingDock',
      'showStreamIndicator',
      'notificationsEnabled',
      'backgroundCompletionAlerts',
      'skipSaveDialog',
      'downloadEngine',
      'customExcludedDomains'
    ], (stored) => {
      if (stored.torboxApiKey) {
        apiKeyInput.value = stored.torboxApiKey;
        testConnection(stored.torboxApiKey, false);
      }

      autoScanToggle.checked = stored.autoScan !== false;
      scanTextLinksToggle.checked = stored.scanTextLinks !== false;
      showFloatingDockToggle.checked = stored.showFloatingDock !== false;
      notificationsToggle.checked = stored.notificationsEnabled !== false;
      backgroundCompletionAlertsToggle.checked = stored.backgroundCompletionAlerts !== false;
      skipSaveDialogToggle.checked = stored.skipSaveDialog !== false;
      downloadEngineSelect.value = stored.downloadEngine || 'idm';

      if (Array.isArray(stored.customExcludedDomains)) {
        excludedDomainsTextarea.value = stored.customExcludedDomains.join('\n');
      }
    });
  }

  // 3. Device code sign-in
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
    optAuthStatusText.textContent = text;
    optAuthStatusText.className = 'auth-status' + (state ? ` is-${state}` : '');
  }

  function setSigninStatus(text, state) {
    optSigninStatus.textContent = text || '';
    optSigninStatus.className = 'auth-status' + (state ? ` is-${state}` : '');
    optSigninStatus.hidden = !text;
  }

  optCopyAuthCodeBtn.addEventListener('click', async () => {
    const code = optAuthCodeDisplay.textContent.trim();
    if (!code || code === '------') return;
    const copied = await copyText(code);
    setAuthStatus(copied ? 'Code copied to clipboard.' : 'Could not copy the code. Select it and copy manually.', copied ? 'success' : 'error');
  });

  optDeviceAuthBtn.addEventListener('click', () => {
    optDeviceAuthBtn.disabled = true;
    optDeviceAuthBtn.textContent = 'Connecting…';
    setSigninStatus('');

    chrome.runtime.sendMessage({ action: TorBoxConstants.MESSAGES.START_DEVICE_AUTH }, async (res) => {
      optDeviceAuthBtn.disabled = false;
      optDeviceAuthBtn.textContent = 'Sign in';

      if (chrome.runtime.lastError) {
        setSigninStatus(`Could not reach the extension background: ${chrome.runtime.lastError.message}`, 'error');
        return;
      }

      if (!res || !res.success || !res.authData) {
        const errMsg = (res && (res.detail || res.error)) || 'Could not start sign-in. Check your connection and try again.';
        setSigninStatus(typeof errMsg === 'object' ? JSON.stringify(errMsg) : errMsg, 'error');
        return;
      }

      const data = res.authData;
      const authCode = data.code || data.user_code || data.device_code || '------';
      const verifyUrl = buildVerificationUrl(data, authCode);

      optAuthCodeDisplay.textContent = authCode;
      optAuthVerifyLink.href = verifyUrl;
      optAuthCodeContainer.hidden = false;
      setAuthStatus('Waiting for approval…');

      // Copy before opening the tab so the clipboard write is not interrupted.
      const copied = await copyText(authCode);
      setAuthStatus(
        copied ? 'Code copied. Finish signing in on the TorBox page.' : 'Copy the code below if the TorBox page does not fill it in.'
      );

      chrome.tabs.create({ url: verifyUrl });

      if (deviceAuthPollTimer) clearInterval(deviceAuthPollTimer);
      const intervalMs = (data.interval || 5) * 1000;

      deviceAuthPollTimer = setInterval(() => {
        chrome.runtime.sendMessage({
          action: TorBoxConstants.MESSAGES.CHECK_DEVICE_AUTH_TOKEN,
          deviceCode: data.device_code
        }, (tokenRes) => {
          if (tokenRes && tokenRes.success && tokenRes.token) {
            clearInterval(deviceAuthPollTimer);
            deviceAuthPollTimer = null;
            setAuthStatus('Connected.', 'success');
            apiKeyInput.value = tokenRes.token;
            testConnection(tokenRes.token, true);
            setTimeout(() => {
              optAuthCodeContainer.hidden = true;
            }, 3000);
          }
        });
      }, intervalMs);
    });
  });

  // Listen for background login completion
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local' && changes.torboxApiKey && changes.torboxApiKey.newValue) {
      if (deviceAuthPollTimer) clearInterval(deviceAuthPollTimer);
      deviceAuthPollTimer = null;
      setAuthStatus('Connected.', 'success');
      apiKeyInput.value = changes.torboxApiKey.newValue;
      testConnection(changes.torboxApiKey.newValue, true);
      setTimeout(() => {
        optAuthCodeContainer.hidden = true;
      }, 2000);
    }
  });

  // 4. API Key Password Visibility Toggle
  toggleVisibleBtn.addEventListener('click', () => {
    apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
  });

  // 5. Save API Key
  saveKeyBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    if (!key) {
      showStatus(apiStatusMsg, 'Enter a valid API key.', false);
      return;
    }

    chrome.storage.local.set({ torboxApiKey: key }, () => {
      showStatus(apiStatusMsg, 'API key saved.', true);
      testConnection(key, true);
    });
  });

  // 6. Test Connection
  testKeyBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    if (!key) {
      showStatus(apiStatusMsg, 'Enter an API key first.', false);
      return;
    }
    testConnection(key, true);
  });

  async function testConnection(key, showFeedback = true) {
    if (showFeedback) {
      testKeyBtn.disabled = true;
      testKeyBtn.textContent = 'Testing…';
    }

    chrome.runtime.sendMessage({
      action: TorBoxConstants.MESSAGES.TEST_AUTH,
      apiKey: key
    }, (data) => {
      if (showFeedback) {
        testKeyBtn.disabled = false;
        testKeyBtn.textContent = 'Test connection';
      }

      if (chrome.runtime.lastError) {
        accountOverviewCard.hidden = true;
        if (showFeedback) {
          showStatus(apiStatusMsg, `Connection error: ${chrome.runtime.lastError.message}`, false);
        }
        return;
      }

      if (data && data.success && data.data) {
        const u = data.data;
        const planTier = TorBoxConstants.PLAN_TIERS[u.plan] || { name: 'Free', badge: 'FREE', color: '#9ca3af' };

        overviewTierBadge.textContent = planTier.badge;
        overviewEmail.textContent = u.email || u.username || 'User';

        if (u.daily_bandwidth_limit > 0) {
          overviewBandwidth.textContent = `${TorBoxUtils.formatBytes(u.daily_bandwidth_used || 0, 1)} / ${TorBoxUtils.formatBytes(u.daily_bandwidth_limit, 0)}`;
        } else {
          overviewBandwidth.textContent = 'Unlimited';
        }

        overviewExpires.textContent = u.plan_expiration_date ? new Date(u.plan_expiration_date).toLocaleDateString() : 'Lifetime / None';
        overviewTotalDl.textContent = TorBoxUtils.formatBytes(u.total_downloaded || 0);

        accountOverviewCard.hidden = false;

        if (showFeedback) {
          showStatus(apiStatusMsg, `Connected as ${u.email || u.username} (${planTier.name} plan)`, true);
        }
      } else {
        accountOverviewCard.hidden = true;
        if (showFeedback) {
          const errMsg = (data && (data.detail || data.error || data.message)) || 'Invalid key';
          showStatus(apiStatusMsg, `Connection failed: ${typeof errMsg === 'object' ? JSON.stringify(errMsg) : errMsg}`, false);
        }
      }
    });
  }

  // 7. Remove Key
  removeKeyBtn.addEventListener('click', () => {
    chrome.storage.local.remove(['torboxApiKey'], () => {
      apiKeyInput.value = '';
      accountOverviewCard.hidden = true;
      showStatus(apiStatusMsg, 'API key removed.', true);
    });
  });

  // 8. Save Scanning Preferences
  savePreferencesBtn.addEventListener('click', () => {
    chrome.storage.local.set({
      autoScan: autoScanToggle.checked,
      scanTextLinks: scanTextLinksToggle.checked,
      showFloatingDock: showFloatingDockToggle.checked,
      notificationsEnabled: notificationsToggle.checked,
      backgroundCompletionAlerts: backgroundCompletionAlertsToggle.checked,
      skipSaveDialog: skipSaveDialogToggle.checked,
      downloadEngine: downloadEngineSelect.value
    }, () => {
      showStatus(prefsStatusMsg, 'Preferences saved.', true);
    });
  });

  // 9. Save Domain Rules
  saveRulesBtn.addEventListener('click', () => {
    const seen = new Set();
    const lines = [];

    // Accept newline/comma separated input, full URLs, and "*.example.com" wildcards.
    excludedDomainsTextarea.value
      .split(/[\n,]+/)
      .forEach((raw) => {
        const domain = TorBoxUtils.normalizeDomain(raw).replace(/^\*\./, '');
        if (!domain || domain.includes('*')) return;
        if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return;
        if (seen.has(domain)) return;
        seen.add(domain);
        lines.push(domain);
      });

    chrome.storage.local.set({ customExcludedDomains: lines }, () => {
      excludedDomainsTextarea.value = lines.join('\n');
      showStatus(rulesStatusMsg, `Saved ${lines.length} domain rule${lines.length === 1 ? '' : 's'}.`, true);
    });
  });

  // 10. Supported Hosters Directory
  function loadHosters() {
    chrome.runtime.sendMessage({ action: TorBoxConstants.MESSAGES.GET_HOSTERS }, (res) => {
      const hosters = (res && res.hosters) ? res.hosters : TorBoxConstants.DEFAULT_HOSTERS;
      const streams = (res && res.streams) ? res.streams : TorBoxConstants.DEFAULT_STREAMS;

      hostersCache = [];
      hosters.forEach(h => hostersCache.push({ domain: h, type: 'Hoster' }));
      streams.forEach(s => hostersCache.push({ domain: s, type: 'Stream' }));

      hostersCount.textContent = `${hostersCache.length}`;
      renderHostersTable();
    });
  }

  function renderHostersTable() {
    const q = (hosterSearchInput.value || '').trim().toLowerCase();
    const filtered = hostersCache.filter(item => !q || item.domain.toLowerCase().includes(q));

    if (filtered.length === 0) {
      hostersTableBody.innerHTML = `<tr><td colspan="3" class="table-message">No hosters match that search.</td></tr>`;
      return;
    }

    let html = '';
    filtered.forEach(item => {
      const isStream = item.type === 'Stream';
      html += `
        <tr>
          <td><strong>${escapeHtml(item.domain)}</strong></td>
          <td><span class="badge-tag ${isStream ? 'stream' : 'hoster'}">${item.type}</span></td>
          <td><span class="badge-tag active">Supported</span></td>
        </tr>
      `;
    });

    hostersTableBody.innerHTML = html;
  }

  hosterSearchInput.addEventListener('input', renderHostersTable);

  function showStatus(el, text, isSuccess) {
    el.textContent = text;
    el.className = `status-box ${isSuccess ? 'success' : 'error'}`;
    el.hidden = false;
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => {
      el.hidden = true;
    }, 4000);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Initial Load
  loadSettings();
  loadHosters();
});
