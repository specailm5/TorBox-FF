document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('apiKey');
  const toggleBtn = document.getElementById('toggleVisible');
  const saveKeyBtn = document.getElementById('saveKey');
  const testKeyBtn = document.getElementById('testKey');
  const removeKeyBtn = document.getElementById('removeKey');
  const apiStatus = document.getElementById('apiStatus');

  const autoScanCheckbox = document.getElementById('autoScan');
  const showUncachedCheckbox = document.getElementById('showUncached');
  const showErrorsCheckbox = document.getElementById('showErrors');
  const displayModeSelect = document.getElementById('displayMode');
  const saveSettingsBtn = document.getElementById('saveSettings');
  const settingsStatus = document.getElementById('settingsStatus');

  // Load saved key
  chrome.storage.local.get(['torboxApiKey', 'autoScan', 'showUncached', 'showErrors', 'displayMode'], (result) => {
    if (result.torboxApiKey) {
      apiKeyInput.value = result.torboxApiKey;
    }
    
    autoScanCheckbox.checked = result.autoScan !== false; // default true
    showUncachedCheckbox.checked = result.showUncached !== false;
    showErrorsCheckbox.checked = result.showErrors === true; // default false
    displayModeSelect.value = result.displayMode || 'buttons';
  });

  // Toggle visibility
  toggleBtn.addEventListener('click', () => {
    if (apiKeyInput.type === 'password') {
      apiKeyInput.type = 'text';
    } else {
      apiKeyInput.type = 'password';
    }
  });

  // Save key
  saveKeyBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    if (!key) {
      showStatus(apiStatus, 'Please enter a valid API key', false);
      return;
    }
    chrome.storage.local.set({ torboxApiKey: key }, () => {
      showStatus(apiStatus, 'API Key saved successfully', true);
    });
  });

  // Remove key
  removeKeyBtn.addEventListener('click', () => {
    chrome.storage.local.remove(['torboxApiKey'], () => {
      apiKeyInput.value = '';
      showStatus(apiStatus, 'API Key removed', true);
    });
  });

  // Test connection
  testKeyBtn.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    if (!key) {
      showStatus(apiStatus, 'Save an API key first', false);
      return;
    }

    testKeyBtn.disabled = true;
    testKeyBtn.textContent = 'Testing...';
    apiStatus.textContent = '';

    // A simple endpoint to test auth
    fetch('https://api.torbox.app/v1/api/user/me', {
      headers: {
        'Authorization': `Bearer ${key}`
      }
    })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        showStatus(apiStatus, `Connection successful! Welcome, ${data.data.username || data.data.email || 'User'}.`, true);
      } else {
        showStatus(apiStatus, `Connection failed: ${data.detail}`, false);
      }
    })
    .catch(err => {
      showStatus(apiStatus, `Error connecting to TorBox: ${err.message}`, false);
    })
    .finally(() => {
      testKeyBtn.disabled = false;
      testKeyBtn.textContent = 'Test Connection';
    });
  });

  // Save settings
  saveSettingsBtn.addEventListener('click', () => {
    chrome.storage.local.set({
      autoScan: autoScanCheckbox.checked,
      showUncached: showUncachedCheckbox.checked,
      showErrors: showErrorsCheckbox.checked,
      displayMode: displayModeSelect.value
    }, () => {
      showStatus(settingsStatus, 'Preferences saved', true);
    });
  });

  function showStatus(element, message, isSuccess) {
    element.textContent = message;
    element.className = 'status-msg ' + (isSuccess ? 'success' : 'error');
    setTimeout(() => {
      element.textContent = '';
      element.className = 'status-msg';
    }, 4000);
  }
});
