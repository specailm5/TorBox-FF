/**
 * TorBox Options Page Controller
 */

document.addEventListener('DOMContentLoaded', () => {
  // Sidebar Navigation
  const navItems = document.querySelectorAll('.nav-item');
  const settingsSections = document.querySelectorAll('.settings-section');

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
  const showUncachedToggle = document.getElementById('showUncachedToggle');
  const showErrorsToggle = document.getElementById('showErrorsToggle');
  const showStreamToggle = document.getElementById('showStreamToggle');
  const notificationsToggle = document.getElementById('notificationsToggle');
  const skipSaveDialogToggle = document.getElementById('skipSaveDialogToggle');
  const downloadEngineSelect = document.getElementById('downloadEngineSelect');
  const displayModeSelect = document.getElementById('displayModeSelect');
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

  // 1. Navigation Controller
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      navItems.forEach(n => n.classList.remove('active'));
      settingsSections.forEach(s => s.classList.remove('active'));

      item.classList.add('active');
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
      'showUncached',
      'showErrors',
      'showStreamIndicator',
      'notificationsEnabled',
      'skipSaveDialog',
      'downloadEngine',
      'displayMode',
      'customExcludedDomains'
    ], (stored) => {
      if (stored.torboxApiKey) {
        apiKeyInput.value = stored.torboxApiKey;
        testConnection(stored.torboxApiKey, false);
      }

      autoScanToggle.checked = stored.autoScan !== false;
      scanTextLinksToggle.checked = stored.scanTextLinks !== false;
      showUncachedToggle.checked = stored.showUncached !== false;
      showErrorsToggle.checked = stored.showErrors === true;
      showStreamToggle.checked = stored.showStreamIndicator !== false;
      notificationsToggle.checked = stored.notificationsEnabled !== false;
      skipSaveDialogToggle.checked = stored.skipSaveDialog !== false;
      downloadEngineSelect.value = stored.downloadEngine || 'idm';
      displayModeSelect.value = stored.displayMode || 'buttons';

      if (Array.isArray(stored.customExcludedDomains)) {
        excludedDomainsTextarea.value = stored.customExcludedDomains.join('\n');
      }
    });
  }

  // 3. API Key Password Visibility Toggle
  toggleVisibleBtn.addEventListener('click', () => {
    apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
  });

  // 4. Save API Key
  saveKeyBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    if (!key) {
      showStatus(apiStatusMsg, 'Please enter a valid API key', false);
      return;
    }

    chrome.storage.local.set({ torboxApiKey: key }, () => {
      showStatus(apiStatusMsg, 'API Key saved successfully', true);
      testConnection(key, true);
    });
  });

  // 5. Test Connection
  testKeyBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    if (!key) {
      showStatus(apiStatusMsg, 'Please enter an API key first', false);
      return;
    }
    testConnection(key, true);
  });

  async function testConnection(key, showFeedback = true) {
    if (showFeedback) {
      testKeyBtn.disabled = true;
      testKeyBtn.textContent = 'Testing...';
    }

    try {
      const res = await fetch('https://api.torbox.app/v1/api/user/me?settings=true', {
        headers: { 'Authorization': `Bearer ${key}` }
      });
      const data = await res.json();

      if (data && data.success && data.data) {
        const u = data.data;
        const planTier = TorBoxConstants.PLAN_TIERS[u.plan] || { name: 'Free', badge: 'FREE', color: '#94a3b8' };

        overviewTierBadge.textContent = planTier.badge;
        overviewTierBadge.style.background = planTier.color;
        overviewEmail.textContent = u.email || u.username || 'User';

        if (u.daily_bandwidth_limit > 0) {
          overviewBandwidth.textContent = `${TorBoxUtils.formatBytes(u.daily_bandwidth_used || 0, 1)} / ${TorBoxUtils.formatBytes(u.daily_bandwidth_limit, 0)}`;
        } else {
          overviewBandwidth.textContent = 'Unlimited';
        }

        overviewExpires.textContent = u.plan_expiration_date ? new Date(u.plan_expiration_date).toLocaleDateString() : 'Lifetime / None';
        overviewTotalDl.textContent = TorBoxUtils.formatBytes(u.total_downloaded || 0);

        accountOverviewCard.style.display = 'flex';

        if (showFeedback) {
          showStatus(apiStatusMsg, `Connected successfully as ${u.email || u.username}! (${planTier.name} Plan)`, true);
        }
      } else {
        accountOverviewCard.style.display = 'none';
        if (showFeedback) {
          showStatus(apiStatusMsg, `Connection failed: ${data.detail || data.error || 'Invalid key'}`, false);
        }
      }
    } catch (err) {
      accountOverviewCard.style.display = 'none';
      if (showFeedback) {
        showStatus(apiStatusMsg, `Connection error: ${err.message}`, false);
      }
    } finally {
      if (showFeedback) {
        testKeyBtn.disabled = false;
        testKeyBtn.textContent = 'Test Connection';
      }
    }
  }

  // 6. Remove Key
  removeKeyBtn.addEventListener('click', () => {
    chrome.storage.local.remove(['torboxApiKey'], () => {
      apiKeyInput.value = '';
      accountOverviewCard.style.display = 'none';
      showStatus(apiStatusMsg, 'API Key disconnected', true);
    });
  });

  // 7. Save Scanning Preferences
  savePreferencesBtn.addEventListener('click', () => {
    chrome.storage.local.set({
      autoScan: autoScanToggle.checked,
      scanTextLinks: scanTextLinksToggle.checked,
      showUncached: showUncachedToggle.checked,
      showErrors: showErrorsToggle.checked,
      showStreamIndicator: showStreamToggle.checked,
      notificationsEnabled: notificationsToggle.checked,
      skipSaveDialog: skipSaveDialogToggle.checked,
      downloadEngine: downloadEngineSelect.value,
      displayMode: displayModeSelect.value
    }, () => {
      showStatus(prefsStatusMsg, 'Scanning preferences saved successfully', true);
    });
  });

  // 8. Save Domain Rules
  saveRulesBtn.addEventListener('click', () => {
    const lines = excludedDomainsTextarea.value
      .split('\n')
      .map(l => l.trim().toLowerCase())
      .filter(Boolean);

    chrome.storage.local.set({ customExcludedDomains: lines }, () => {
      showStatus(rulesStatusMsg, `Saved ${lines.length} domain exclusion rule(s)`, true);
    });
  });

  // 9. Supported Hosters Directory
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
      hostersTableBody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--text-dim);">No matching hosters found.</td></tr>`;
      return;
    }

    let html = '';
    filtered.forEach(item => {
      const isStream = item.type === 'Stream';
      html += `
        <tr>
          <td><strong style="color:var(--text-main);">${escapeHtml(item.domain)}</strong></td>
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
    el.style.display = 'block';
    setTimeout(() => {
      el.style.display = 'none';
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
