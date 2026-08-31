/**
 * TorBox Background Service Worker
 * Full TorBox API v1 integration:
 * - POST-based high-performance batch cache checking
 * - Instant CDN downloads (multi-file & full zip)
 * - Real-time video/audio streaming links
 * - Magnet to .torrent conversion
 * - Torrent inspection & peer lookup
 * - Device code OAuth authentication
 * - Direct cloud storage offloading (GDrive, OneDrive, Dropbox, etc.)
 * - Background download completion alerts via alarms
 * - Enhanced context menus
 */

// Import shared dependencies
try {
  importScripts('../shared/constants.js', '../shared/utils.js', '../lib/md5.js');
} catch (e) {
  console.error("Failed to import scripts in background worker:", e);
}

const HOSTER_CACHE_TTL = 60 * 60 * 1000; // 1 hour
const URL_CACHE_TTL = 10 * 60 * 1000;    // 10 minutes
const ALARM_CHECK_DOWNLOADS = 'torbox_check_downloads_alarm';

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
    throw new Error('API key is not configured. Please open Settings or Sign in.');
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
    const shouldSkipSaveAs = settings.skipSaveDialog !== false;

    if (chrome.downloads && chrome.downloads.download) {
      const downloadOptions = {
        url: downloadUrl,
        saveAs: !shouldSkipSaveAs,
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
        serverTime: u.server_time,
        settings: u.settings || {}
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Fetches detailed user statistics and bandwidth trends.
 */
async function getUserStats() {
  try {
    const data = await apiRequest('/v1/api/user/stats?general=true&bandwidth=true&bandwidth_grouping=day');
    return { success: true, stats: data.data || {} };
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
 * Checks cache availability for a batch of URLs using POST requests with JSON payloads.
 */
async function checkCache(urls, listFiles = false) {
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
    if (cachedEntry && (now - (cachedEntry.timestamp || 0) < URL_CACHE_TTL) && (!listFiles || cachedEntry.files)) {
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
        torrentUrlsToCheck.push({ url, hash: md5(url) });
      } else if (url.toLowerCase().endsWith('.nzb')) {
        usenetUrlsToCheck.push(url);
      } else {
        webUrlsToCheck.push(url);
      }
    }
  }

  const CHUNK_SIZE = 100;

  // 1. Process WebDL URLs via POST
  for (let i = 0; i < webUrlsToCheck.length; i += CHUNK_SIZE) {
    const chunk = webUrlsToCheck.slice(i, i + CHUNK_SIZE);
    const hashes = chunk.map(u => md5(u));

    try {
      const data = await apiRequest('/v1/api/webdl/checkcached?format=object', 'POST', { hashes });
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

  // 2. Process Torrent / Magnet URLs via POST
  for (let i = 0; i < torrentUrlsToCheck.length; i += CHUNK_SIZE) {
    const chunk = torrentUrlsToCheck.slice(i, i + CHUNK_SIZE);
    const hashes = chunk.map(item => item.hash);

    try {
      const listFilesParam = listFiles ? '&list_files=true' : '';
      const data = await apiRequest(`/v1/api/torrents/checkcached?format=object${listFilesParam}`, 'POST', { hashes });
      const cacheData = data.data || {};

      for (let j = 0; j < chunk.length; j++) {
        const { url, hash } = chunk[j];

        let isCached = false;
        let fileList = null;

        if (Array.isArray(cacheData)) {
          const found = cacheData.find(item => (typeof item === 'object' ? item.hash === hash : item === hash));
          isCached = !!found;
          if (found && typeof found === 'object' && found.files) fileList = found.files;
        } else if (cacheData[hash]) {
          isCached = true;
          if (typeof cacheData[hash] === 'object' && cacheData[hash].files) {
            fileList = cacheData[hash].files;
          }
        }

        const state = isCached ? TorBoxConstants.STATES.CACHED : TorBoxConstants.STATES.NOT_CACHED;
        results[url] = state;
        urlStorageCache[url] = { state, files: fileList, timestamp: now };
      }
    } catch (error) {
      console.warn("Torrent cache check batch error:", error.message);
      chunk.forEach(item => {
        results[item.url] = TorBoxConstants.STATES.ERROR;
      });
    }
  }

  // 3. Process Usenet URLs via POST
  for (let i = 0; i < usenetUrlsToCheck.length; i += CHUNK_SIZE) {
    const chunk = usenetUrlsToCheck.slice(i, i + CHUNK_SIZE);
    const hashes = chunk.map(u => md5(u));

    try {
      const data = await apiRequest('/v1/api/usenet/checkcached?format=object', 'POST', { hashes });
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
 * Supports specific fileId if provided.
 */
async function downloadCached(url, fileId = null) {
  try {
    const isMagnet = url.startsWith('magnet:?');
    const isTorrentFile = url.toLowerCase().endsWith('.torrent') || url.toLowerCase().includes('.torrent?');
    const isUsenet = url.toLowerCase().endsWith('.nzb') || url.toLowerCase().includes('.nzb?');
    const apiKey = await getApiKey();

    if (!apiKey) {
      throw new Error("No API key configured. Please open Settings or Sign in.");
    }

    let downloadUrl = null;

    if (isMagnet || isTorrentFile) {
      const formData = new FormData();
      if (isMagnet) {
        formData.append('magnet', url);
      } else {
        try {
          const tRes = await fetch(url);
          if (tRes.ok) {
            const blob = await tRes.blob();
            formData.append('file', blob, 'download.torrent');
          } else {
            throw new Error(`Failed to fetch .torrent file: HTTP ${tRes.status}`);
          }
        } catch (fetchErr) {
          const extractedHash = TorBoxUtils.extractMagnetHash(url);
          if (extractedHash) {
            formData.append('magnet', extractedHash);
          } else {
            formData.append('link', url);
          }
        }
      }
      formData.append('allow_zip', 'true');
      formData.append('seed', '1');

      const createRes = await fetch(`${TorBoxConstants.API_BASE}/v1/api/torrents/createtorrent`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}` },
        body: formData
      });
      const createData = await createRes.json();

      if (!createRes.ok || createData.success === false) {
        let err = createData.detail || createData.error || 'Failed to create torrent download';
        if (typeof err === 'object') err = Array.isArray(err) ? err.map(e => e.msg || JSON.stringify(e)).join(', ') : JSON.stringify(err);
        throw new Error(err);
      }

      const torrentId = createData.data ? (createData.data.torrent_id || createData.data.id) : null;
      if (!torrentId) {
        throw new Error("Torrent ID was not returned by TorBox.");
      }

      const dlResult = await requestDirectLink(torrentId, 'torrent', fileId, fileId === null);
      if (!dlResult.success || !dlResult.downloadUrl) {
        throw new Error(dlResult.error || 'Failed to generate direct download link.');
      }
      downloadUrl = dlResult.downloadUrl;

    } else if (isUsenet) {
      const formData = new FormData();
      formData.append('link', url);

      const createRes = await fetch(`${TorBoxConstants.API_BASE}/v1/api/usenet/createusenetdownload`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}` },
        body: formData
      });
      const createData = await createRes.json();

      if (!createRes.ok || createData.success === false) {
        let err = createData.detail || createData.error || 'Failed to create usenet download';
        if (typeof err === 'object') err = Array.isArray(err) ? err.map(e => e.msg || JSON.stringify(e)).join(', ') : JSON.stringify(err);
        throw new Error(err);
      }

      const usenetId = createData.data ? (createData.data.usenet_id || createData.data.id) : null;
      if (!usenetId) throw new Error("Usenet ID not returned.");

      const dlResult = await requestDirectLink(usenetId, 'usenet', fileId, fileId === null);
      if (!dlResult.success || !dlResult.downloadUrl) {
        throw new Error(dlResult.error || 'Failed to generate usenet download link');
      }
      downloadUrl = dlResult.downloadUrl;

    } else {
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
        let err = createData.detail || createData.error || 'Failed to create WebDL download';
        if (typeof err === 'object') err = Array.isArray(err) ? err.map(e => e.msg || JSON.stringify(e)).join(', ') : JSON.stringify(err);
        throw new Error(err);
      }

      const webId = createData.data ? (createData.data.webdownload_id || createData.data.webdl_id || createData.data.id) : null;
      if (!webId) throw new Error("WebDL ID not returned.");

      const dlResult = await requestDirectLink(webId, 'webdl', fileId, false);
      if (!dlResult.success || !dlResult.downloadUrl) {
        throw new Error(dlResult.error || 'Failed to generate WebDL download link');
      }
      downloadUrl = dlResult.downloadUrl;
    }

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
 * Creates a download on TorBox cloud (for torrents, magnets, filehosters, and usenet).
 * Adds the link to user's TorBox account and triggers notifications.
 */
async function createCloudDownload(url) {
  try {
    const apiKey = await getApiKey();
    if (!apiKey) throw new Error('No API key configured. Please open Settings or Sign in.');

    const isMagnet = url.startsWith('magnet:?');
    const isTorrentFile = url.toLowerCase().endsWith('.torrent') || url.toLowerCase().includes('.torrent?');
    const isUsenet = url.toLowerCase().endsWith('.nzb') || url.toLowerCase().includes('.nzb?');

    let endpoint = '/v1/api/webdl/createwebdownload';
    const formData = new FormData();

    if (isMagnet) {
      endpoint = '/v1/api/torrents/createtorrent';
      formData.append('magnet', url);
      formData.append('allow_zip', 'true');
      formData.append('seed', '1');
      formData.append('as_queued', 'false');
    } else if (isTorrentFile) {
      let torrentBlob = null;
      try {
        const fileRes = await fetch(url);
        if (fileRes.ok) {
          torrentBlob = await fileRes.blob();
        }
      } catch (e) {
        console.warn("Could not fetch .torrent file directly:", e.message);
      }

      if (torrentBlob) {
        endpoint = '/v1/api/torrents/createtorrent';
        formData.append('file', torrentBlob, 'download.torrent');
        formData.append('allow_zip', 'true');
        formData.append('seed', '1');
        formData.append('as_queued', 'false');
      } else {
        endpoint = '/v1/api/webdl/createwebdownload';
        formData.append('link', url);
        formData.append('as_queued', 'false');
      }
    } else if (isUsenet) {
      endpoint = '/v1/api/usenet/createusenetdownload';
      formData.append('link', url);
      formData.append('post_processing', '-1');
      formData.append('as_queued', 'false');
    } else {
      formData.append('link', url);
      formData.append('as_queued', 'false');
    }

    let response = await fetch(`${TorBoxConstants.API_BASE}${endpoint}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}` },
      body: formData
    });

    let data = await response.json();

    // Fallback to async endpoint if primary failed
    if (!response.ok || data.success === false) {
      if (isMagnet) {
        try {
          const asyncFormData = new FormData();
          asyncFormData.append('magnet', url);
          const asyncRes = await fetch(`${TorBoxConstants.API_BASE}/v1/api/torrents/asynccreatetorrent`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}` },
            body: asyncFormData
          });
          const asyncData = await asyncRes.json();
          if (asyncRes.ok && asyncData.success !== false) {
            data = asyncData;
            response = asyncRes;
          }
        } catch (e) {}
      } else if (!isUsenet && !isTorrentFile) {
        try {
          const asyncFormData = new FormData();
          asyncFormData.append('link', url);
          const asyncRes = await fetch(`${TorBoxConstants.API_BASE}/v1/api/webdl/asynccreatewebdownload`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}` },
            body: asyncFormData
          });
          const asyncData = await asyncRes.json();
          if (asyncRes.ok && asyncData.success !== false) {
            data = asyncData;
            response = asyncRes;
          }
        } catch (e) {}
      }
    }

    if (!response.ok || data.success === false) {
      let errDetail = data.detail || data.error || 'Failed to queue download on TorBox';
      if (typeof errDetail === 'object') {
        errDetail = Array.isArray(errDetail) ? errDetail.map(e => e.msg || JSON.stringify(e)).join(', ') : JSON.stringify(errDetail);
      }
      showNotification('TorBox - Add Failed', errDetail, true);
      throw new Error(errDetail);
    }

    const successMsg = data.detail || 'Link queued to your TorBox cloud!';
    showNotification('TorBox - Added to Cloud', successMsg);

    return {
      success: true,
      data: data.data,
      detail: successMsg
    };
  } catch (error) {
    console.error("createCloudDownload error:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Generates a clean direct CDN download/stream URL for an existing item by ID.
 * Returns { success: true, downloadUrl: string }
 */
async function requestDirectLink(id, type = 'torrent', fileId = null, zipLink = false) {
  try {
    const apiKey = await getApiKey();
    if (!apiKey) throw new Error('No API key configured');

    const fileParam = (fileId !== null && fileId !== undefined) ? `&file_id=${fileId}` : '';
    const zipParam = zipLink ? '&zip_link=true' : '&zip_link=false';
    let endpoint = '';

    if (type === 'webdl') {
      endpoint = `${TorBoxConstants.API_BASE}/v1/api/webdl/requestdl?token=${encodeURIComponent(apiKey)}&web_id=${id}${fileParam}${zipParam}&redirect=false`;
    } else if (type === 'usenet') {
      endpoint = `${TorBoxConstants.API_BASE}/v1/api/usenet/requestdl?token=${encodeURIComponent(apiKey)}&usenet_id=${id}${fileParam}${zipParam}&redirect=false`;
    } else {
      endpoint = `${TorBoxConstants.API_BASE}/v1/api/torrents/requestdl?token=${encodeURIComponent(apiKey)}&torrent_id=${id}${fileParam}${zipParam}&redirect=false`;
    }

    const res = await fetch(endpoint);
    let data;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      data = await res.json();
    } else {
      const text = await res.text();
      try { data = JSON.parse(text); } catch (e) { data = text; }
    }

    if (res.ok && data) {
      if (data.success !== false) {
        let directUrl = null;
        if (typeof data === 'string' && data.startsWith('http')) {
          directUrl = data;
        } else if (data.data) {
          if (typeof data.data === 'string') directUrl = data.data;
          else if (typeof data.data === 'object') directUrl = data.data.url || data.data.stream_url || data.data.download_url || data.data.link;
        }

        if (directUrl) {
          return { success: true, downloadUrl: directUrl };
        }
      }
    }

    const errMsg = (data && (data.detail || data.error || data.message)) || `Server returned HTTP ${res.status}`;
    throw new Error(typeof errMsg === 'object' ? JSON.stringify(errMsg) : errMsg);
  } catch (error) {
    console.warn("requestDirectLink error:", error.message);
    return { success: false, error: error.message };
  }
}



/**
 * Requests CDN download URL for an item by ID and optionally initiates browser download.
 */
async function requestDownloadById(id, type, fileId = null) {
  try {
    const zipLink = (fileId === null || fileId === undefined);
    const dlRes = await requestDirectLink(id, type, fileId, zipLink);

    if (!dlRes.success || !dlRes.downloadUrl) {
      throw new Error(dlRes.error || 'Failed to generate download link');
    }

    const downloadUrl = dlRes.downloadUrl;
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
 * Converts a magnet link to a .torrent file.
 */
async function magnetToFile(magnetUrl) {
  try {
    const apiKey = await getApiKey();
    if (!apiKey) throw new Error('No API key configured');

    const res = await apiRequest('/v1/api/torrents/magnettofile', 'POST', { magnet: magnetUrl });
    if (res && res.success && res.data) {
      return { success: true, torrentData: res.data };
    }
    throw new Error(res.detail || res.error || 'Failed to convert magnet to torrent');
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Retrieves torrent metadata (seeders, peers, file tree).
 */
async function getTorrentInfo(hashOrMagnet) {
  try {
    const isMagnet = hashOrMagnet.startsWith('magnet:?');
    const query = isMagnet
      ? `magnet=${encodeURIComponent(hashOrMagnet)}&use_cache_lookup=true`
      : `hash=${hashOrMagnet}&use_cache_lookup=true`;

    const res = await apiRequest(`/v1/api/torrents/torrentinfo?${query}`);
    return { success: true, info: res.data || {} };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Starts Device Code OAuth Authorization flow and runs background polling.
 */
let activeDeviceAuthPollTimer = null;

async function startDeviceAuth() {
  try {
    const response = await fetch(`${TorBoxConstants.API_BASE}/v1/api/user/auth/device/start?app=TorBox%20Extension`);
    const data = await response.json();
    if (!response.ok || data.success === false) {
      throw new Error(data.detail || data.error || 'Failed to start device authorization');
    }

    const authData = data.data;
    if (authData && authData.device_code) {
      if (activeDeviceAuthPollTimer) clearInterval(activeDeviceAuthPollTimer);
      const intervalMs = Math.max((authData.interval || 5) * 1000, 3000);
      let attempts = 0;
      const maxAttempts = 120; // 10 minutes maximum

      activeDeviceAuthPollTimer = setInterval(async () => {
        attempts++;
        if (attempts > maxAttempts) {
          clearInterval(activeDeviceAuthPollTimer);
          activeDeviceAuthPollTimer = null;
          return;
        }

        const res = await checkDeviceAuthToken(authData.device_code);
        if (res && res.success && res.token) {
          clearInterval(activeDeviceAuthPollTimer);
          activeDeviceAuthPollTimer = null;
        }
      }, intervalMs);
    }

    return { success: true, authData: data.data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Checks token for a pending Device Code Authorization.
 */
async function checkDeviceAuthToken(deviceCode) {
  try {
    const response = await fetch(`${TorBoxConstants.API_BASE}/v1/api/user/auth/device/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_code: deviceCode })
    });
    const data = await response.json();

    let token = null;
    if (data && data.success) {
      if (typeof data.data === 'string' && data.data.trim()) {
        token = data.data.trim();
      } else if (data.data && typeof data.data === 'object') {
        token = data.data.session_token || data.data.token || data.data.access_token || data.data.api_token || data.data.api_key || data.data.key;
      } else if (typeof data.token === 'string') {
        token = data.token;
      } else if (typeof data.session_token === 'string') {
        token = data.session_token;
      } else if (typeof data.access_token === 'string') {
        token = data.access_token;
      }
    }

    if (token) {
      await chrome.storage.local.set({ torboxApiKey: token });
      showNotification('TorBox - Connected', 'Successfully signed in to your TorBox account!');
      return { success: true, token };
    }

    return {
      success: false,
      error: data.detail || data.error || 'Authorization pending or expired'
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Pushes item to connected cloud storage (Google Drive, Dropbox, OneDrive, Gofile, 1Fichier, Pixeldrain).
 */
async function sendToCloud(id, fileId = null, type = 'torrent', provider = 'googledrive', userToken = null) {
  try {
    const body = {
      id: parseInt(id),
      type: type,
      zip: fileId === null
    };
    if (fileId !== null) body.file_id = parseInt(fileId);

    if (provider === 'dropbox' && userToken) body.dropbox_token = userToken;
    if (provider === 'onedrive' && userToken) body.onedrive_token = userToken;
    if (provider === 'googledrive' && userToken) body.google_token = userToken;
    if (provider === 'gofile' && userToken) body.gofile_token = userToken;
    if (provider === '1fichier' && userToken) body.onefichier_token = userToken;
    if (provider === 'pixeldrain' && userToken) body.pixeldrain_token = userToken;

    const res = await apiRequest(`/v1/api/integration/${provider}`, 'POST', body);
    return { success: true, data: res.data };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Fetches connected OAuth integrations.
 */
async function getCloudIntegrations() {
  try {
    const res = await apiRequest('/v1/api/integration/oauth/me');
    return { success: true, integrations: res.data || {} };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Retrieves all active, queued, and cached downloads from the user's TorBox account.
 */
async function getActiveDownloads() {
  try {
    const [torrentsRes, webdlRes, usenetRes, queuedRes] = await Promise.allSettled([
      apiRequest('/v1/api/torrents/mylist?bypass_cache=true'),
      apiRequest('/v1/api/webdl/mylist?bypass_cache=true'),
      apiRequest('/v1/api/usenet/mylist?bypass_cache=true'),
      apiRequest('/v1/api/queued/getqueued?bypass_cache=true')
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
          createdAt: w.created_at || null,
          files: w.files || []
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
          createdAt: u.created_at || null,
          files: u.files || []
        });
      });
    }

    // Queued items
    if (queuedRes.status === 'fulfilled' && queuedRes.value && queuedRes.value.data) {
      const list = Array.isArray(queuedRes.value.data) ? queuedRes.value.data : [];
      list.forEach(q => {
        downloads.push({
          id: q.id,
          name: q.name || 'Queued Item',
          size: q.size || 0,
          progress: 0,
          status: 'queued',
          type: q.type || 'torrent',
          speed: 0,
          eta: null,
          createdAt: q.created_at || null,
          isQueued: true
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
    } else if (type === 'queued') {
      endpoint = '/v1/api/queued/controlqueued';
      body.queued_id = id;
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
 * Background Alarm Handler for Completed Downloads Notifications
 */
let knownActiveJobIds = new Set();

async function checkBackgroundDownloadStatus() {
  try {
    const apiKey = await getApiKey();
    if (!apiKey) return;

    const settings = await chrome.storage.local.get(['backgroundCompletionAlerts']);
    if (settings.backgroundCompletionAlerts === false) return;

    const res = await getActiveDownloads();
    if (!res || !res.success || !res.downloads) return;

    const currentDownloads = res.downloads;
    const currentActiveIds = new Set();

    for (const dl of currentDownloads) {
      const isDone = dl.status === 'completed' || dl.status === 'cached';
      if (!isDone && dl.status !== 'queued') {
        currentActiveIds.add(dl.id);
      } else if (isDone && knownActiveJobIds.has(dl.id)) {
        // Transitioned from active to completed!
        showNotification(
          "🟢 TorBox Cloud Complete",
          `"${dl.name}" has finished downloading on TorBox and is ready!`
        );
      }
    }

    knownActiveJobIds = currentActiveIds;
  } catch (e) {
    console.warn("Background download status check failed:", e);
  }
}

// Setup background alarm
chrome.alarms.create(ALARM_CHECK_DOWNLOADS, { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_CHECK_DOWNLOADS) {
    checkBackgroundDownloadStatus();
  }
});

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

  if (action === TorBoxConstants.MESSAGES.GET_USER_STATS) {
    getUserStats().then(sendResponse);
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
    checkCache(message.urls, message.listFiles).then(results => sendResponse({ results })).catch(() => sendResponse({ results: {} }));
    return true;
  }

  if (action === TorBoxConstants.MESSAGES.DOWNLOAD_CACHED) {
    downloadCached(message.url, message.fileId).then(sendResponse);
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



  if (action === TorBoxConstants.MESSAGES.MAGNET_TO_FILE) {
    magnetToFile(message.magnet).then(sendResponse);
    return true;
  }

  if (action === TorBoxConstants.MESSAGES.GET_TORRENT_INFO) {
    getTorrentInfo(message.hashOrMagnet).then(sendResponse);
    return true;
  }

  if (action === TorBoxConstants.MESSAGES.START_DEVICE_AUTH) {
    startDeviceAuth().then(sendResponse);
    return true;
  }

  if (action === TorBoxConstants.MESSAGES.CHECK_DEVICE_AUTH_TOKEN) {
    checkDeviceAuthToken(message.deviceCode).then(sendResponse);
    return true;
  }

  if (action === TorBoxConstants.MESSAGES.SEND_TO_CLOUD) {
    sendToCloud(message.id, message.fileId, message.type, message.provider, message.token).then(sendResponse);
    return true;
  }

  if (action === TorBoxConstants.MESSAGES.GET_CLOUD_INTEGRATIONS) {
    getCloudIntegrations().then(sendResponse);
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
    requestDownloadById(message.id, message.type, message.fileId).then(sendResponse);
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
    contexts: ["link", "selection", "page"]
  });

  chrome.contextMenus.create({
    id: "torbox-download-instant",
    parentId: "torbox-context-root",
    title: "⚡ Instant Download / Add to TorBox",
    contexts: ["link", "selection"]
  });



  chrome.contextMenus.create({
    id: "torbox-magnet-to-torrent",
    parentId: "torbox-context-root",
    title: "💾 Save Magnet as .torrent File",
    contexts: ["link", "selection"]
  });

  chrome.contextMenus.create({
    id: "torbox-check-cache",
    parentId: "torbox-context-root",
    title: "🔍 Check TorBox Cache Status",
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

  } else if (info.menuItemId === "torbox-magnet-to-torrent") {
    if (!targetUrl.startsWith('magnet:?')) {
      showNotification("TorBox", "Selected item is not a magnet link", true);
      return;
    }
    showNotification("TorBox", "Converting magnet to .torrent file...");
    const res = await magnetToFile(targetUrl);
    if (res.success && res.torrentData) {
      const name = TorBoxUtils.extractMagnetName(targetUrl) || 'download';
      const blobUrl = `data:application/x-bittorrent;base64,${btoa(unescape(encodeURIComponent(JSON.stringify(res.torrentData))))}`;
      await startNativeDownload(blobUrl, `${name}.torrent`);
      showNotification("TorBox", "Torrent file saved!");
    } else {
      showNotification("TorBox Error", res.error || "Conversion failed", true);
    }
  } else if (info.menuItemId === "torbox-check-cache") {
    const cacheResult = await checkCache([targetUrl]);
    const state = cacheResult[targetUrl];
    if (state === TorBoxConstants.STATES.CACHED) {
      showNotification("TorBox Cache Status", "🟢 CACHED! Instant download available.");
    } else if (state === TorBoxConstants.STATES.NOT_CACHED) {
      showNotification("TorBox Cache Status", "⚪ Not cached. Can be queued to TorBox.");
    } else {
      showNotification("TorBox Cache Status", "⚠️ Status: " + (state || "Unknown"));
    }
  }
});
