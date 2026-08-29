/**
 * TorBox Background Service Worker
 * Handles API communication, persistent caching, native downloads, and context menus.
 */

// Import shared dependencies
try {
  importScripts('../shared/constants.js', '../shared/utils.js', '../lib/md5.js');
} catch (e) {
  console.error("Failed to import scripts in background worker:", e);
}

const HOSTER_CACHE_TTL = 60 * 60 * 1000; // 1 hour
const URL_CACHE_TTL = 10 * 60 * 1000;    // 10 minutes

/**
 * Storage-backed Cache Controller
 */
const CacheStorage = {
  async get(key) {
    try {
      const data = await chrome.storage.local.get([key]);
      return data[key];
    } catch (e) {
      return null;
    }
  },
  async set(key, value) {
    try {
      await chrome.storage.local.set({ [key]: value });
    } catch (e) {
      console.warn("CacheStorage set failed:", e);
    }
  },
  async remove(key) {
    try {
      await chrome.storage.local.remove([key]);
    } catch (e) {}
  }
};

/**
 * Retrieves the configured API Key.
 */
async function getApiKey() {
  const result = await chrome.storage.local.get(['torboxApiKey']);
  return (result.torboxApiKey || '').trim();
}

/**
 * Performs an authenticated HTTP request to the TorBox API.
 */
async function apiRequest(endpoint, method = 'GET', body = null) {
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error('API key is not configured. Please open Settings.');
  }

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Accept': 'application/json'
  };

  let reqBody = body;
  if (body && !(body instanceof FormData) && typeof body === 'object') {
    headers['Content-Type'] = 'application/json';
    reqBody = JSON.stringify(body);
  }

  const url = `${TorBoxConstants.API_BASE}${endpoint}`;

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: reqBody
    });

    let data;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      const text = await response.text();
      try {
        data = JSON.parse(text);
      } catch (e) {
        if (!response.ok) {
          throw new Error(`Server returned HTTP ${response.status}: ${text.substring(0, 100)}`);
        }
        data = { success: true, data: text };
      }
    }

    if (!response.ok || data.success === false) {
      let errDetail = data.detail || data.error || data.message || `API request failed with HTTP ${response.status}`;
      if (typeof errDetail === 'object') errDetail = JSON.stringify(errDetail);
      throw new Error(errDetail);
    }

    return data;
  } catch (error) {
    console.error(`TorBox API Error [${method} ${endpoint}]:`, error.message);
    throw error;
  }
}

/**
 * Shows desktop toast notification.
 */
async function showNotification(title, message, isError = false) {
  try {
    const settings = await chrome.storage.local.get(['notificationsEnabled']);
    if (settings.notificationsEnabled === false) return;

    if (chrome.notifications && chrome.notifications.create) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL('icons/icon48.png'),
        title: title || 'TorBox Manager',
        message: message || '',
        priority: isError ? 2 : 1
      });
    }
  } catch (e) {
    console.warn("Notification trigger failed:", e);
  }
}

/**
 * Triggers native browser download using chrome.downloads API.
 */
async function startNativeDownload(downloadUrl, filename = null) {
  if (!downloadUrl) return { success: false, error: "No download URL provided" };

  try {
    const settings = await chrome.storage.local.get(['skipSaveDialog']);
    const shouldSkipSaveAs = settings.skipSaveDialog !== false; // default true to skip save window

    if (chrome.downloads && chrome.downloads.download) {
      const downloadOptions = {
        url: downloadUrl,
        saveAs: !shouldSkipSaveAs, // false = skip the save window completely
        conflictAction: 'uniquify'
      };
      if (filename) downloadOptions.filename = filename;

      const downloadId = await chrome.downloads.download(downloadOptions);
      return { success: true, downloadId };
    } else {
      return { success: true, downloadUrl, fallback: true };
    }
  } catch (error) {
    console.error("Native download failed:", error);
    return { success: false, error: error.message, downloadUrl };
  }
}

/**
 * Fetches user profile & quota information.
 */
async function getUserInfo() {
  try {
    const data = await apiRequest('/v1/api/user/me?settings=true');
    const u = data.data || {};

    const planTier = TorBoxConstants.PLAN_TIERS[u.plan] || { name: 'Free', badge: 'FREE', color: '#94a3b8' };

    return {
      success: true,
      user: {
        id: u.id,
        email: u.email,
        username: u.username || (u.email ? u.email.split('@')[0] : 'User'),
        plan: u.plan || 0,
        planName: planTier.name,
        planBadge: planTier.badge,
        planColor: planTier.color,
        isSubscribed: !!u.is_subscribed,
        expiration: u.plan_expiration_date,
        totalDownloaded: u.total_downloaded || 0,
        bandwidthLimit: u.daily_bandwidth_limit || 0,
        bandwidthUsed: u.daily_bandwidth_used || 0,
        serverTime: u.server_time
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Fetches and caches supported hosters & streams from TorBox API.
 */
async function getHosters() {
  const cachedData = await CacheStorage.get('torbox_hosters_cache');
  const now = Date.now();

  if (cachedData && cachedData.hosters && (now - (cachedData.timestamp || 0) < HOSTER_CACHE_TTL)) {
    return { hosters: cachedData.hosters, streams: cachedData.streams };
  }

  try {
    const data = await apiRequest('/v1/api/webdl/hosters');
    let rawList = [];
    if (Array.isArray(data.data)) {
      rawList = data.data;
    } else if (data.data && Array.isArray(data.data.hosters)) {
      rawList = data.data.hosters;
    }

    const hosterSet = new Set();
    const streamSet = new Set();

    rawList.forEach(h => {
      const isStream = h && typeof h === 'object' && h.type && h.type !== 'hoster';
      const targetSet = isStream ? streamSet : hosterSet;

      if (typeof h === 'string') {
        targetSet.add(h.toLowerCase());
      } else if (h && typeof h === 'object') {
        if (Array.isArray(h.domains)) {
          h.domains.forEach(d => targetSet.add(d.toLowerCase()));
        } else if (typeof h.domain === 'string') {
          targetSet.add(h.domain.toLowerCase());
        } else if (h.host) {
          targetSet.add(h.host.toLowerCase());
        }
      }
    });

    // Merge fallback defaults to ensure comprehensive coverage
    TorBoxConstants.DEFAULT_HOSTERS.forEach(d => hosterSet.add(d.toLowerCase()));
    TorBoxConstants.DEFAULT_STREAMS.forEach(d => streamSet.add(d.toLowerCase()));

    const excluded = new Set(['youtube.com', 'youtu.be', 'google.com']);
    const hosters = Array.from(hosterSet).filter(d => !excluded.has(d));
    const streams = Array.from(streamSet).filter(d => !excluded.has(d));

    await CacheStorage.set('torbox_hosters_cache', {
      hosters,
      streams,
      timestamp: now
    });

    return { hosters, streams };
  } catch (error) {
    console.warn("Failed to fetch online hosters, falling back to defaults:", error.message);
    return {
      hosters: TorBoxConstants.DEFAULT_HOSTERS,
      streams: TorBoxConstants.DEFAULT_STREAMS
    };
  }
}

/**
 * Checks cache availability for a batch of URLs (WebDL, Torrents, Usenet).
 */
async function checkCache(urls) {
  if (!Array.isArray(urls) || urls.length === 0) return {};
  const uniqueUrls = [...new Set(urls.filter(Boolean))];
  const results = {};

  let urlStorageCache = (await CacheStorage.get('torbox_url_cache')) || {};
  const now = Date.now();

  const webUrlsToCheck = [];
  const torrentUrlsToCheck = [];
  const usenetUrlsToCheck = [];

  // Check persistent cache
  for (const url of uniqueUrls) {
    const cachedEntry = urlStorageCache[url];
    if (cachedEntry && (now - (cachedEntry.timestamp || 0) < URL_CACHE_TTL)) {
      results[url] = cachedEntry.state;
    } else {
      if (url.startsWith('magnet:?')) {
        const hash = TorBoxUtils.extractMagnetHash(url);
        if (hash) {
          torrentUrlsToCheck.push({ url, hash });
        } else {
          results[url] = TorBoxConstants.STATES.UNSUPPORTED;
        }
      } else if (url.toLowerCase().endsWith('.torrent')) {
        // Direct torrent URLs
        torrentUrlsToCheck.push({ url, hash: md5(url) });
      } else if (url.toLowerCase().endsWith('.nzb')) {
        usenetUrlsToCheck.push(url);
      } else {
        webUrlsToCheck.push(url);
      }
    }
  }

  const CHUNK_SIZE = 80;

  // 1. Process WebDL URLs
  for (let i = 0; i < webUrlsToCheck.length; i += CHUNK_SIZE) {
    const chunk = webUrlsToCheck.slice(i, i + CHUNK_SIZE);
    const hashes = chunk.map(u => md5(u));
    const hashStr = hashes.join(',');

    try {
      const data = await apiRequest(`/v1/api/webdl/checkcached?hash=${hashStr}&format=object`);
      const cacheData = data.data || {};

      for (let j = 0; j < chunk.length; j++) {
        const url = chunk[j];
        const hash = hashes[j];

        let isCached = false;
        if (Array.isArray(cacheData)) {
          isCached = !!cacheData.find(item => (typeof item === 'object' ? item.hash === hash : item === hash));
        } else {
          isCached = !!cacheData[hash];
        }

        const state = isCached ? TorBoxConstants.STATES.CACHED : TorBoxConstants.STATES.NOT_CACHED;
        results[url] = state;
        urlStorageCache[url] = { state, timestamp: now };
      }
    } catch (error) {
      console.warn("WebDL cache check batch error:", error.message);
      chunk.forEach(url => {
        results[url] = TorBoxConstants.STATES.ERROR;
      });
    }
  }

  // 2. Process Torrent / Magnet URLs
  for (let i = 0; i < torrentUrlsToCheck.length; i += CHUNK_SIZE) {
    const chunk = torrentUrlsToCheck.slice(i, i + CHUNK_SIZE);
    const hashes = chunk.map(item => item.hash);
    const hashStr = hashes.join(',');

    try {
      const data = await apiRequest(`/v1/api/torrents/checkcached?hash=${hashStr}&format=object`);
      const cacheData = data.data || {};

      for (let j = 0; j < chunk.length; j++) {
        const { url, hash } = chunk[j];

        let isCached = false;
        if (Array.isArray(cacheData)) {
          isCached = !!cacheData.find(item => (typeof item === 'object' ? item.hash === hash : item === hash));
        } else {
          isCached = !!cacheData[hash];
        }

        const state = isCached ? TorBoxConstants.STATES.CACHED : TorBoxConstants.STATES.NOT_CACHED;
        results[url] = state;
        urlStorageCache[url] = { state, timestamp: now };
      }
    } catch (error) {
      console.warn("Torrent cache check batch error:", error.message);
      chunk.forEach(item => {
        results[item.url] = TorBoxConstants.STATES.ERROR;
      });
    }
  }

  // 3. Process Usenet URLs
  for (let i = 0; i < usenetUrlsToCheck.length; i += CHUNK_SIZE) {
    const chunk = usenetUrlsToCheck.slice(i, i + CHUNK_SIZE);
    const hashes = chunk.map(u => md5(u));
    const hashStr = hashes.join(',');

    try {
      const data = await apiRequest(`/v1/api/usenet/checkcached?hash=${hashStr}&format=object`);
      const cacheData = data.data || {};

      for (let j = 0; j < chunk.length; j++) {
        const url = chunk[j];
        const hash = hashes[j];

        let isCached = false;
        if (Array.isArray(cacheData)) {
          isCached = !!cacheData.find(item => (typeof item === 'object' ? item.hash === hash : item === hash));
        } else {
          isCached = !!cacheData[hash];
        }

        const state = isCached ? TorBoxConstants.STATES.CACHED : TorBoxConstants.STATES.NOT_CACHED;
        results[url] = state;
        urlStorageCache[url] = { state, timestamp: now };
      }
    } catch (error) {
      console.warn("Usenet cache check batch error:", error.message);
      chunk.forEach(url => {
        results[url] = TorBoxConstants.STATES.ERROR;
      });
    }
  }

  // Save updated cache to storage
  await CacheStorage.set('torbox_url_cache', urlStorageCache);
  return results;
}

/**
 * Downloads a cached item instantly, requesting CDN direct link and triggering native download.
 */
async function downloadCached(url) {
  try {
    const isMagnet = url.startsWith('magnet:?');
    const isTorrentFile = url.toLowerCase().endsWith('.torrent');
    const isUsenet = url.toLowerCase().endsWith('.nzb');
    const apiKey = await getApiKey();

    if (!apiKey) {
      throw new Error("No API key configured. Please open Settings.");
    }

    let downloadUrl = null;

    if (isMagnet || isTorrentFile) {
      // 1. Create torrent with seed/add
      const formData = new FormData();
      if (isMagnet) {
        formData.append('magnet', url);
      } else {
        formData.append('link', url);
      }
      formData.append('allow_zip', 'true');

      const createRes = await fetch(`${TorBoxConstants.API_BASE}/v1/api/torrents/createtorrent`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}` },
        body: formData
      });
      const createData = await createRes.json();

      if (!createRes.ok || createData.success === false) {
        throw new Error(createData.detail || createData.error || 'Failed to create torrent download');
      }

      const torrentId = createData.data ? (createData.data.torrent_id || createData.data.id) : null;
      if (!torrentId) {
        throw new Error("Torrent ID was not returned by TorBox.");
      }

      // Request direct CDN download link
      const reqUrl = `${TorBoxConstants.API_BASE}/v1/api/torrents/requestdl?token=${apiKey}&torrent_id=${torrentId}&zip_link=true`;
      const dlRes = await fetch(reqUrl);
      const dlData = await dlRes.json();

      if (!dlRes.ok || dlData.success === false) {
        throw new Error(dlData.detail || dlData.error || 'Failed to generate direct download link.');
      }
      downloadUrl = dlData.data;

    } else if (isUsenet) {
      // 2. Create Usenet
      const formData = new FormData();
      formData.append('link', url);

      const createRes = await fetch(`${TorBoxConstants.API_BASE}/v1/api/usenet/createusenetdownload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}` },
        body: formData
      });
      const createData = await createRes.json();

      if (!createRes.ok || createData.success === false) {
        throw new Error(createData.detail || createData.error || 'Failed to create usenet download');
      }

      const usenetId = createData.data ? (createData.data.usenet_id || createData.data.id) : null;
      if (!usenetId) throw new Error("Usenet ID not returned.");

      const reqUrl = `${TorBoxConstants.API_BASE}/v1/api/usenet/requestdl?token=${apiKey}&usenet_id=${usenetId}&zip_link=true`;
      const dlRes = await fetch(reqUrl);
      const dlData = await dlRes.json();
      if (!dlRes.ok || dlData.success === false) {
        throw new Error(dlData.detail || dlData.error || 'Failed to generate usenet download link');
      }
      downloadUrl = dlData.data;

    } else {
      // 3. WebDL
      const formData = new FormData();
      formData.append('link', url);
      formData.append('add_only_if_cached', 'true');

      const createRes = await fetch(`${TorBoxConstants.API_BASE}/v1/api/webdl/createwebdownload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}` },
        body: formData
      });
      const createData = await createRes.json();

      if (!createRes.ok || createData.success === false) {
        throw new Error(createData.detail || createData.error || 'Failed to create WebDL download');
      }

      const webId = createData.data ? (createData.data.webdownload_id || createData.data.webdl_id || createData.data.id) : null;
      if (!webId) throw new Error("WebDL ID not returned.");

      downloadUrl = `${TorBoxConstants.API_BASE}/v1/api/webdl/requestdl?token=${apiKey}&web_id=${webId}&redirect=true`;
    }

    // Check download engine preference (idm vs browser)
    const settings = await chrome.storage.local.get(['downloadEngine']);
    const engine = settings.downloadEngine || 'idm';

    if (engine === 'browser') {
      await startNativeDownload(downloadUrl);
    }

    return {
      success: true,
      downloadUrl,
      engine
    };
  } catch (error) {
    console.error("downloadCached error:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Creates an uncached download on TorBox cloud.
 */
async function createCloudDownload(url) {
  try {
    const apiKey = await getApiKey();
    if (!apiKey) throw new Error('No API key configured');

    const isMagnet = url.startsWith('magnet:?');
    const isTorrentFile = url.toLowerCase().endsWith('.torrent');
    const isUsenet = url.toLowerCase().endsWith('.nzb');

    let endpoint = '/v1/api/webdl/createwebdownload';
    const formData = new FormData();

    if (isMagnet) {
      endpoint = '/v1/api/torrents/createtorrent';
      formData.append('magnet', url);
    } else if (isTorrentFile) {
      endpoint = '/v1/api/torrents/createtorrent';
      formData.append('link', url);
    } else if (isUsenet) {
      endpoint = '/v1/api/usenet/createusenetdownload';
      formData.append('link', url);
    } else {
      formData.append('link', url);
    }

    const response = await fetch(`${TorBoxConstants.API_BASE}${endpoint}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: formData
    });

    const data = await response.json();
    if (!response.ok || data.success === false) {
      let errDetail = data.detail || data.error || 'Failed to queue download on TorBox';
      if (typeof errDetail === 'object') errDetail = JSON.stringify(errDetail);
      throw new Error(errDetail);
    }

    return { success: true, data: data.data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Retrieves all active and cached downloads from the user's TorBox account.
 */
async function getActiveDownloads() {
  try {
    const [torrentsRes, webdlRes, usenetRes] = await Promise.allSettled([
      apiRequest('/v1/api/torrents/mylist?bypass_cache=true'),
      apiRequest('/v1/api/webdl/mylist?bypass_cache=true'),
      apiRequest('/v1/api/usenet/mylist?bypass_cache=true')
    ]);

    let downloads = [];

    if (torrentsRes.status === 'fulfilled' && torrentsRes.value && torrentsRes.value.data) {
      const list = Array.isArray(torrentsRes.value.data) ? torrentsRes.value.data : [];
      list.forEach(t => {
        downloads.push({
          id: t.id,
          name: t.name || 'Torrent Download',
          size: t.size || 0,
          progress: typeof t.progress === 'number' ? t.progress : 0,
          status: t.download_state || t.download_status || 'unknown',
          type: 'torrent',
          speed: t.download_speed || 0,
          eta: t.eta || null,
          createdAt: t.created_at || null,
          files: t.files || []
        });
      });
    }

    if (webdlRes.status === 'fulfilled' && webdlRes.value && webdlRes.value.data) {
      const list = Array.isArray(webdlRes.value.data) ? webdlRes.value.data : [];
      list.forEach(w => {
        downloads.push({
          id: w.id,
          name: w.name || 'Web Download',
          size: w.size || 0,
          progress: typeof w.progress === 'number' ? w.progress : 0,
          status: w.download_state || w.download_status || 'unknown',
          type: 'webdl',
          speed: w.download_speed || 0,
          eta: w.eta || null,
          createdAt: w.created_at || null
        });
      });
    }

    if (usenetRes.status === 'fulfilled' && usenetRes.value && usenetRes.value.data) {
      const list = Array.isArray(usenetRes.value.data) ? usenetRes.value.data : [];
      list.forEach(u => {
        downloads.push({
          id: u.id,
          name: u.name || 'Usenet Download',
          size: u.size || 0,
          progress: typeof u.progress === 'number' ? u.progress : 0,
          status: u.download_state || u.download_status || 'unknown',
          type: 'usenet',
          speed: u.download_speed || 0,
          eta: u.eta || null,
          createdAt: u.created_at || null
        });
      });
    }

    return { success: true, downloads };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Controls an existing download (delete, pause, resume).
 */
async function controlDownload(id, type, operation = 'delete') {
  try {
    const apiKey = await getApiKey();
    let endpoint = '';
    const body = {};

    if (type === 'torrent') {
      endpoint = '/v1/api/torrents/controltorrent';
      body.torrent_id = id;
      body.operation = operation;
    } else if (type === 'webdl') {
      endpoint = '/v1/api/webdl/controlwebdownload';
      body.webdownload_id = id;
      body.operation = operation;
    } else if (type === 'usenet') {
      endpoint = '/v1/api/usenet/controlusenetdownload';
      body.usenet_id = id;
      body.operation = operation;
    } else {
      throw new Error(`Unknown type: ${type}`);
    }

    await apiRequest(endpoint, 'POST', body);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Requests CDN download URL for an existing download item by ID.
 */
async function requestDownloadById(id, type) {
  try {
    const apiKey = await getApiKey();
    let downloadUrl = '';

    if (type === 'torrent') {
      const reqUrl = `${TorBoxConstants.API_BASE}/v1/api/torrents/requestdl?token=${apiKey}&torrent_id=${id}&zip_link=true`;
      const dlRes = await fetch(reqUrl);
      const dlData = await dlRes.json();
      if (!dlRes.ok || dlData.success === false) {
        throw new Error(dlData.detail || dlData.error || 'Failed to generate download link');
      }
      downloadUrl = dlData.data;
    } else if (type === 'webdl') {
      downloadUrl = `${TorBoxConstants.API_BASE}/v1/api/webdl/requestdl?token=${apiKey}&web_id=${id}&redirect=true`;
    } else if (type === 'usenet') {
      const reqUrl = `${TorBoxConstants.API_BASE}/v1/api/usenet/requestdl?token=${apiKey}&usenet_id=${id}&zip_link=true`;
      const dlRes = await fetch(reqUrl);
      const dlData = await dlRes.json();
      if (!dlRes.ok || dlData.success === false) {
        throw new Error(dlData.detail || dlData.error || 'Failed to generate download link');
      }
      downloadUrl = dlData.data;
    } else {
      throw new Error(`Unknown type: ${type}`);
    }

    const settings = await chrome.storage.local.get(['downloadEngine']);
    const engine = settings.downloadEngine || 'idm';

    if (engine === 'browser') {
      await startNativeDownload(downloadUrl);
    }

    return { success: true, downloadUrl, engine };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Message Handler Router
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { action } = message;

  if (action === TorBoxConstants.MESSAGES.UPDATE_BADGE) {
    if (sender && sender.tab && sender.tab.id) {
      const text = message.count > 0 ? message.count.toString() : '';
      chrome.action.setBadgeText({ text, tabId: sender.tab.id });
      if (message.count > 0) {
        chrome.action.setBadgeBackgroundColor({ color: '#10b981', tabId: sender.tab.id });
      }
    }
    sendResponse({ success: true });
    return true;
  }

  if (action === TorBoxConstants.MESSAGES.GET_USER_INFO) {
    getUserInfo().then(sendResponse);
    return true;
  }

  if (action === TorBoxConstants.MESSAGES.GET_HOSTERS) {
    getHosters().then(sendResponse).catch(() => sendResponse({
      hosters: TorBoxConstants.DEFAULT_HOSTERS,
      streams: TorBoxConstants.DEFAULT_STREAMS
    }));
    return true;
  }

  if (action === TorBoxConstants.MESSAGES.CHECK_CACHE) {
    checkCache(message.urls).then(results => sendResponse({ results })).catch(() => sendResponse({ results: {} }));
    return true;
  }

  if (action === TorBoxConstants.MESSAGES.DOWNLOAD_CACHED) {
    downloadCached(message.url).then(sendResponse);
    return true;
  }

  if (action === TorBoxConstants.MESSAGES.START_NATIVE_DOWNLOAD) {
    startNativeDownload(message.url, message.filename).then(sendResponse);
    return true;
  }

  if (action === TorBoxConstants.MESSAGES.CREATE_WEBDL || action === TorBoxConstants.MESSAGES.CREATE_TORRENT || action === TorBoxConstants.MESSAGES.CREATE_USENET) {
    createCloudDownload(message.url).then(sendResponse);
    return true;
  }

  if (action === TorBoxConstants.MESSAGES.GET_ACTIVE_DOWNLOADS) {
    getActiveDownloads().then(sendResponse);
    return true;
  }

  if (action === TorBoxConstants.MESSAGES.CONTROL_DOWNLOAD) {
    controlDownload(message.id, message.type, message.operation).then(sendResponse);
    return true;
  }

  if (action === TorBoxConstants.MESSAGES.REQUEST_DOWNLOAD_BY_ID) {
    requestDownloadById(message.id, message.type).then(sendResponse);
    return true;
  }

  if (action === TorBoxConstants.MESSAGES.SHOW_NOTIFICATION) {
    showNotification(message.title, message.message, message.isError);
    sendResponse({ success: true });
    return true;
  }
});

/**
 * Context Menus Setup
 */
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "torbox-context-root",
    title: "TorBox",
    contexts: ["link", "selection"]
  });

  chrome.contextMenus.create({
    id: "torbox-download-instant",
    parentId: "torbox-context-root",
    title: "⚡ Instant Download / Add to TorBox",
    contexts: ["link", "selection"]
  });

  chrome.contextMenus.create({
    id: "torbox-check-cache",
    parentId: "torbox-context-root",
    title: "🔍 Check TorBox Cache",
    contexts: ["link", "selection"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  let targetUrl = (info.linkUrl || info.selectionText || '').trim();
  if (!targetUrl) return;

  if (info.menuItemId === "torbox-download-instant") {
    showNotification("TorBox", "Checking and initiating download...");
    const cacheResult = await checkCache([targetUrl]);
    const isCached = cacheResult[targetUrl] === TorBoxConstants.STATES.CACHED;

    if (isCached) {
      const res = await downloadCached(targetUrl);
      if (res.success) {
        showNotification("TorBox - Download Started", "Cached file sent to your browser download manager!");
      } else {
        showNotification("TorBox - Error", res.error || "Failed to download", true);
      }
    } else {
      const res = await createCloudDownload(targetUrl);
      if (res.success) {
        showNotification("TorBox - Added to Cloud", "Link queued on your TorBox cloud!");
      } else {
        showNotification("TorBox - Error", res.error || "Failed to add to TorBox", true);
      }
    }
  } else if (info.menuItemId === "torbox-check-cache") {
    const cacheResult = await checkCache([targetUrl]);
    const state = cacheResult[targetUrl];
    if (state === TorBoxConstants.STATES.CACHED) {
      showNotification("TorBox Cache Status", "🟢 CACHED! Instant download available.");
    } else if (state === TorBoxConstants.STATES.NOT_CACHED) {
      showNotification("TorBox Cache Status", "⚪ Not cached. Can be added to TorBox queue.");
    } else {
      showNotification("TorBox Cache Status", "⚠️ Status: " + (state || "Unknown"));
    }
  }
});
