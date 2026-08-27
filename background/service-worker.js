importScripts('../shared/constants.js', '../shared/utils.js', '../lib/md5.js');

let cachedHosters = null;
let cachedStreams = null;
let lastHosterFetch = 0;
const HOSTER_CACHE_DURATION = 60 * 60 * 1000; // 1 hour

// Memory cache for URL checking results to avoid spamming the API
const urlCheckCache = new Map();

async function getApiKey() {
  const result = await chrome.storage.local.get(['torboxApiKey']);
  return result.torboxApiKey;
}

async function apiRequest(endpoint, method = 'GET', body = null) {
  const apiKey = await getApiKey();
  if (!apiKey) {
    throw new Error('No API key configured');
  }

  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Accept': 'application/json'
  };

  if (body && !(body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }

  const url = `${TorBoxConstants.API_BASE}${endpoint}`;
  
  try {
    const response = await fetch(url, { method, headers, body });
    const data = await response.json();
    
    if (!response.ok || data.success === false) {
      let errDetail = data.detail || data.error || `API request failed with status ${response.status}`;
      if (typeof errDetail === 'object') errDetail = JSON.stringify(errDetail);
      throw new Error(errDetail);
    }
    
    return data;
  } catch (error) {
    console.error(`TorBox API Error [${method} ${endpoint}]:`, error);
    throw error;
  }
}

async function getHosters() {
  if (cachedHosters && cachedStreams && (Date.now() - lastHosterFetch < HOSTER_CACHE_DURATION)) {
    return { hosters: cachedHosters, streams: cachedStreams };
  }

  try {
    const data = await apiRequest('/v1/api/webdl/hosters');
    let hosters = [];
    if (Array.isArray(data.data)) {
      hosters = data.data;
    } else if (data.data && Array.isArray(data.data.hosters)) {
      hosters = data.data.hosters;
    }
    
    let domains = [];
    let streams = [];
    hosters.forEach(h => {
      // Differentiate between streaming sites and file hosters
      const isStream = h && typeof h === 'object' && h.type && h.type !== 'hoster';
      const targetList = isStream ? streams : domains;
      
      if (typeof h === 'string') {
        targetList.push(h);
      } else if (h.domains && Array.isArray(h.domains)) {
        targetList.push(...h.domains);
      } else if (typeof h.domain === 'string') {
        targetList.push(h.domain);
      } else if (h.host) {
        targetList.push(h.host);
      }
    });
    
    const excludedDomains = ['youtube.com', 'youtu.be'];
    cachedHosters = domains.map(d => d.toLowerCase()).filter(d => !excludedDomains.includes(d));
    cachedStreams = streams.map(d => d.toLowerCase()).filter(d => !excludedDomains.includes(d));
    lastHosterFetch = Date.now();
    return { hosters: cachedHosters, streams: cachedStreams };
  } catch (error) {
    console.error("Failed to fetch hosters", error);
    return null; // Don't cache the error, return null so we can retry later or fallback
  }
}

function extractMagnetHash(url) {
  if (!url.startsWith('magnet:')) return null;
  const match = url.match(/xt=urn:btih:([a-zA-Z0-9]+)/i);
  return match ? match[1].toLowerCase() : null;
}

async function checkCache(urls) {
  const uniqueUrls = [...new Set(urls)];
  const results = {};
  
  const webUrlsToCheck = [];
  const torrentUrlsToCheck = [];

  // 1. Check memory cache first
  for (const url of uniqueUrls) {
    if (urlCheckCache.has(url)) {
      results[url] = urlCheckCache.get(url);
    } else {
      if (url.startsWith('magnet:')) {
        const hash = extractMagnetHash(url);
        if (hash) {
          torrentUrlsToCheck.push({ url, hash });
        } else {
          results[url] = TorBoxConstants.STATES.UNSUPPORTED;
        }
      } else {
        webUrlsToCheck.push(url);
      }
    }
  }

  const CHUNK_SIZE = 100;
  
  // 2. Hash remaining Web URLs
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
          const found = cacheData.find(item => item.hash === hash || item === hash);
          isCached = !!found;
        } else {
          isCached = !!cacheData[hash];
        }

        const state = isCached ? TorBoxConstants.STATES.CACHED : TorBoxConstants.STATES.NOT_CACHED;
        results[url] = state;
        
        urlCheckCache.set(url, state);
        setTimeout(() => urlCheckCache.delete(url), 5 * 60 * 1000);
      }
    } catch (error) {
      console.error("Web cache check failed", error);
      chunk.forEach(url => {
        results[url] = TorBoxConstants.STATES.ERROR;
      });
    }
  }

  // 3. Hash remaining Torrent URLs
  for (let i = 0; i < torrentUrlsToCheck.length; i += CHUNK_SIZE) {
    const chunk = torrentUrlsToCheck.slice(i, i + CHUNK_SIZE);
    const hashes = chunk.map(item => item.hash);
    const hashStr = hashes.join(',');

    try {
      const data = await apiRequest(`/v1/api/torrents/checkcached?hash=${hashStr}&format=object`);
      const cacheData = data.data || {};
      
      for (let j = 0; j < chunk.length; j++) {
        const {url, hash} = chunk[j];
        
        let isCached = false;
        if (Array.isArray(cacheData)) {
          const found = cacheData.find(item => item.hash === hash || item === hash);
          isCached = !!found;
        } else {
          isCached = !!cacheData[hash];
        }

        const state = isCached ? TorBoxConstants.STATES.CACHED : TorBoxConstants.STATES.NOT_CACHED;
        results[url] = state;
        
        urlCheckCache.set(url, state);
        setTimeout(() => urlCheckCache.delete(url), 5 * 60 * 1000);
      }
    } catch (error) {
      console.error("Torrent cache check failed", error);
      chunk.forEach(item => {
        results[item.url] = TorBoxConstants.STATES.ERROR;
      });
    }
  }

  return results;
}

async function downloadCached(url) {
  try {
    const isMagnet = url.startsWith('magnet:');
    const endpoint = isMagnet ? '/v1/api/torrents/createtorrent' : '/v1/api/webdl/createwebdownload';
    
    const formData = new FormData();
    if (isMagnet) {
      formData.append('magnet', url);
    } else {
      formData.append('link', url);
      // Only webdl explicitly uses add_only_if_cached=true, but we assume torrents won't re-download if 100% cached
      formData.append('add_only_if_cached', 'true');
    }

    const apiKey = await getApiKey();
    const response = await fetch(`${TorBoxConstants.API_BASE}${endpoint}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      },
      body: formData
    });
    
    const data = await response.json();
    
    if (!response.ok || data.success === false) {
      let errDetail = data.detail || data.error || 'Failed to create cached download';
      if (typeof errDetail === 'object') errDetail = JSON.stringify(errDetail);
      throw new Error(errDetail);
    }

    let downloadId = null;
    if (data.data) {
      downloadId = data.data.torrent_id || data.data.webdownload_id || data.data.webdl_id || data.data.web_id || data.data.id;
    }
    
    if (!downloadId) {
       throw new Error(`Download ID not returned. data: ${JSON.stringify(data.data)}`);
    }

    let downloadUrl;
    if (isMagnet) {
      const reqUrl = `${TorBoxConstants.API_BASE}/v1/api/torrents/requestdl?token=${apiKey}&torrent_id=${downloadId}&zip_link=true`;
      const dlReq = await fetch(reqUrl);
      const dlData = await dlReq.json();
      if (!dlReq.ok || dlData.success === false) {
        throw new Error(dlData.detail || dlData.error || 'Failed to request torrent download URL');
      }
      downloadUrl = dlData.data; // The actual CDN link
    } else {
      downloadUrl = `${TorBoxConstants.API_BASE}/v1/api/webdl/requestdl?token=${apiKey}&web_id=${downloadId}&redirect=true`;
    }

    return { success: true, downloadUrl: downloadUrl };
  } catch (error) {
    console.error("downloadCached error:", error);
    return { success: false, error: error.message };
  }
}

// Handle messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === TorBoxConstants.MESSAGES.GET_HOSTERS) {
    getHosters().then(res => sendResponse(res || { hosters: null, streams: null })).catch(() => sendResponse({ hosters: null, streams: null }));
    return true; // Keep channel open
  }
  
  if (message.action === TorBoxConstants.MESSAGES.CHECK_CACHE) {
    checkCache(message.urls).then(results => sendResponse({ results })).catch(() => sendResponse({ results: {} }));
    return true;
  }

  if (message.action === TorBoxConstants.MESSAGES.DOWNLOAD_CACHED) {
    downloadCached(message.url).then(result => sendResponse(result));
    return true;
  }
  
  if (message.action === TorBoxConstants.MESSAGES.GET_API_KEY) {
    getApiKey().then(key => sendResponse({ key }));
    return true;
  }

  if (message.action === TorBoxConstants.MESSAGES.CREATE_WEBDL) {
    createWebDl(message.url).then(result => sendResponse(result));
    return true;
  }
});

async function createWebDl(url) {
  try {
    const isMagnet = url.startsWith('magnet:');
    const endpoint = isMagnet ? '/v1/api/torrents/createtorrent' : '/v1/api/webdl/createwebdownload';
    
    const formData = new FormData();
    if (isMagnet) {
      formData.append('magnet', url);
    } else {
      formData.append('link', url);
    }

    const apiKey = await getApiKey();
    const response = await fetch(`${TorBoxConstants.API_BASE}${endpoint}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`
      },
      body: formData
    });
    
    const data = await response.json();
    
    if (!response.ok || data.success === false) {
      let errDetail = data.detail || data.error || 'Failed to request download';
      if (typeof errDetail === 'object') errDetail = JSON.stringify(errDetail);
      throw new Error(errDetail);
    }

    return { success: true };
  } catch (error) {
    console.error("createWebDl error:", error);
    return { success: false, error: error.message };
  }
}
