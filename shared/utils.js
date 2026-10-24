/**
 * TorBox Shared Utility Functions
 */
const TorBoxUtils = {
  _hosterSetCache: null,
  _hosterListRef: null,
  _combinedRegexCache: null,

  // Hosters that mix downloadable files with non-file pages (repos, profiles,
  // drives, documents, search pages). A link only counts when it points at a
  // file/share path instead of the site's navigation.
  _strictHosterRules: {
    'github.com': { pathMarkers: ['/releases/download/', '/archive/', '/raw/', '/blob/'] },
    't.me': { pathMarkers: ['/c/'] },
    'dropbox.com': { pathMarkers: ['/s/', '/sh/', '/scl/'] },
    'drive.google.com': { pathMarkers: ['/file/', '/folders/'], queryKeys: ['id'] },
    'cdn.discordapp.com': { pathMarkers: ['/attachments/'] },
    'imgbb.com': { pathMarkers: ['/i/'] },
    'archive.org': { pathMarkers: ['/details/', '/download/'] },
    'scribd.com': { pathMarkers: ['/document/', '/download/'] },
    'annas-archive.org': { pathMarkers: ['/md5/', '/slow_download/', '/fast_download/'] },
    'annas-archive.li': { pathMarkers: ['/md5/', '/slow_download/', '/fast_download/'] },
    'annas-archive.se': { pathMarkers: ['/md5/', '/slow_download/', '/fast_download/'] },
    'annas-archive.pm': { pathMarkers: ['/md5/', '/slow_download/', '/fast_download/'] },
    'annas-archive.in': { pathMarkers: ['/md5/', '/slow_download/', '/fast_download/'] },
    'annas-archive.gl': { pathMarkers: ['/md5/', '/slow_download/', '/fast_download/'] },
    'annas-archive.gd': { pathMarkers: ['/md5/', '/slow_download/', '/fast_download/'] }
  },

  _downloadPathMarkers: [
    'file', 'files', 'download', 'downloads', 'dl', 'share', 'view', 'get',
    'embed', 'watch', 'archive', 'raw', 'blob', 'attachments', 'details',
    'folder', 'folders', 'container', 'gallery', 'album', 'albums', 'md5',
    'slow_download', 'fast_download', 'releases/download'
  ],

  _shareQueryKeys: new Set([
    'file', 'files', 'download', 'downloads', 'dl', 'code', 'key', 'hash',
    'token', 'share', 'url', 'id', 'f', 'u', 'd'
  ]),

  _fileRouteWords: new Set([
    'file', 'files', 'download', 'downloads', 'dl', 'd', 'u', 'f', 's',
    'sh', 'share', 'view', 'get', 'embed', 'watch', 'v', 'folder', 'folders',
    'container', 'archive'
  ]),

  _navigationPaths: new Set([
    'about', 'account', 'accounts', 'api', 'apps', 'article', 'articles',
    'blog', 'browse', 'categories', 'category', 'contact', 'cookie', 'cookies',
    'dmca', 'docs', 'faq', 'features', 'file', 'files', 'forum', 'forums',
    'help', 'home', 'index', 'index.html', 'login', 'logout', 'marketplace',
    'new', 'news', 'page', 'pages', 'popular', 'post', 'posts', 'premium',
    'pricing', 'privacy', 'register', 'search', 'settings', 'signin',
    'sign-in', 'signup', 'sign-up', 'support', 'tags', 'terms', 'thread',
    'threads', 'top', 'topic', 'topics', 'trending', 'upgrade', 'user',
    'users', 'wiki', 'download', 'downloads', 'folder', 'folders'
  ]),

  _fileExtensionRe: /\.(?:zip|rar|7z|tar|gz|bz2|xz|iso|img|apk|exe|msi|dmg|pkg|deb|rpm|pdf|epub|mobi|azw3|cbz|cbr|mp4|mkv|avi|webm|mov|m4v|wmv|flv|mp3|flac|wav|m4a|ogg|opus|aac|jpg|jpeg|png|gif|webp|avif|svg|torrent|nzb)(?:$|[?#])/i,

  /**
   * Builds and caches a Set of hoster domains and a combined RegExp for fast lookups.
   */
  _getHosterLookup(supportedHosters) {
    if (!supportedHosters || supportedHosters.length === 0) {
      return { hosterSet: new Set(), regex: null };
    }

    if (this._hosterListRef === supportedHosters && this._hosterSetCache) {
      return { hosterSet: this._hosterSetCache, regex: this._combinedRegexCache };
    }

    const hosterSet = new Set();
    const escapedDomains = [];

    for (const h of supportedHosters) {
      if (!h || typeof h !== 'string') continue;
      const clean = h.trim().toLowerCase();
      if (!clean) continue;
      hosterSet.add(clean);
      escapedDomains.push(clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    }

    this._hosterListRef = supportedHosters;
    this._hosterSetCache = hosterSet;

    if (escapedDomains.length > 0) {
      // Precise pattern: https?://(?:[a-zA-Z0-9-]+\.)*(?:domain1|domain2)(?::\d+)?(?:/[^\s"'<>]*)?
      this._combinedRegexCache = new RegExp(
        `https?:\\/\\/(?:[a-zA-Z0-9-]+\\.)*(?:${escapedDomains.join('|')})(?::\\d+)?(?:\\/[^\\s"'<>]*)?`,
        'gi'
      );
    } else {
      this._combinedRegexCache = null;
    }

    return { hosterSet, regex: this._combinedRegexCache };
  },

  /**
   * Normalizes a URL by trimming, decoding safe characters, and stripping non-essential hashes.
   * Preserves Mega decryption keys in hashes.
   */
  normalizeUrl(urlStr) {
    if (!urlStr || typeof urlStr !== 'string') return '';
    const trimmed = urlStr.trim();
    if (trimmed.startsWith('magnet:')) return trimmed;

    try {
      const url = new URL(trimmed);
      // Keep hash for Mega URLs because it contains the folder/file decryption key
      const isMega = url.hostname.includes('mega.nz') || url.hostname.includes('mega.co.nz') || url.hostname.includes('mega.io');
      if (!isMega) {
        url.hash = '';
      }
      
      let finalUrl = url.href;
      if (finalUrl.endsWith('/') && url.pathname !== '/') {
        finalUrl = finalUrl.slice(0, -1);
      }
      return finalUrl;
    } catch (e) {
      return trimmed;
    }
  },

  /**
   * Deduplicates an array of URLs after normalization.
   */
  deduplicateUrls(urls) {
    if (!Array.isArray(urls)) return [];
    return [...new Set(urls.map(url => this.normalizeUrl(url)).filter(Boolean))];
  },

  /**
   * Extracts hostname safely from a URL.
   */
  getHostname(urlStr) {
    try {
      if (urlStr.startsWith('magnet:')) return 'magnet';
      const url = new URL(urlStr);
      return url.hostname.toLowerCase();
    } catch (e) {
      return null;
    }
  },

  /**
   * Checks if a hostname is covered by the user's excluded domain rules (subdomains included).
   */
  isDomainExcluded(hostname, excludedDomains) {
    if (!hostname || !Array.isArray(excludedDomains)) return false;
    const host = this.normalizeDomain(hostname);
    if (!host) return false;

    return excludedDomains.some((domain) => {
      const d = this.normalizeDomain(domain);
      if (!d) return false;
      return host === d || host.endsWith('.' + d);
    });
  },

  /**
   * Normalizes any URL, hostname, or domain input into a bare lowercase hostname.
   */
  normalizeDomain(input) {
    if (!input || typeof input !== 'string') return '';
    let value = input.trim().toLowerCase();
    if (!value) return '';

    // Strip scheme, credentials, port, path, query, and hash if a URL was passed
    try {
      if (value.includes('://')) value = new URL(value).hostname;
    } catch (e) {
      value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split('/')[0];
    }
    value = value.split('/')[0].split('?')[0].split('#')[0].split('@').pop();

    // Drop the port and any surrounding brackets/IPv6 punctuation
    if (!value.startsWith('[')) value = value.split(':')[0];
    value = value.replace(/^\.+|\.+$/g, '');

    return value;
  },

  /**
   * Returns the supported hoster domain that covers a hostname, or ''.
   * Handles subdomains (e.g., s1.rapidgator.net -> rapidgator.net).
   */
  _getMatchingHosterDomain(hostname, hosterSet) {
    if (!hostname || !hosterSet) return '';
    const lower = hostname.toLowerCase();
    if (hosterSet.has(lower)) return lower;

    const parts = lower.split('.');
    for (let i = 1; i < parts.length - 1; i++) {
      const parentDomain = parts.slice(i).join('.');
      if (hosterSet.has(parentDomain)) return parentDomain;
    }
    return '';
  },

  /**
   * Checks if a given hostname matches any supported hoster domain (handles subdomains).
   */
  isSupportedHostname(hostname, hosterSet) {
    return Boolean(this._getMatchingHosterDomain(hostname, hosterSet));
  },

  _getStrictHosterRule(hosterDomain) {
    if (!hosterDomain) return null;
    for (const [domain, rule] of Object.entries(this._strictHosterRules)) {
      if (hosterDomain === domain || hosterDomain.endsWith('.' + domain)) {
        return rule;
      }
    }
    return null;
  },

  _hasShareQuery(urlObj, extraKeys, allowBareToken = true) {
    if (!urlObj || !urlObj.search) return false;

    for (const [key, value] of urlObj.searchParams.entries()) {
      const lowerKey = key.toLowerCase();
      if (this._shareQueryKeys.has(lowerKey)) return true;
      if (extraKeys && extraKeys.some(k => k.toLowerCase() === lowerKey)) return true;
      // Bare token query such as 1fichier.com/?abc123
      if (allowBareToken && !value && /^[a-z0-9_-]{4,}$/i.test(key)) return true;
    }
    return false;
  },

  _hasFileExtension(pathname) {
    return this._fileExtensionRe.test(pathname || '');
  },

  /**
   * Some hosters carry the share token in the fragment (legacy mega.nz/#!ID!KEY).
   */
  _hasShareHash(urlObj) {
    const hash = (urlObj && urlObj.hash) || '';
    return /^#(?:F?!|!)[a-z0-9_-]{4,}/i.test(hash);
  },

  _isStrictFileUrl(urlObj, rule) {
    const path = (urlObj.pathname || '').toLowerCase();
    if (!path || path === '/') return false;

    if (this._hasFileExtension(urlObj.pathname)) return true;

    for (const marker of rule.pathMarkers || []) {
      if (path.includes(marker.toLowerCase())) return true;
    }

    for (const marker of this._downloadPathMarkers) {
      if (path.includes('/' + marker + '/')) return true;
    }

    return this._hasShareQuery(urlObj, rule.queryKeys, false);
  },

  _isDownloadableHosterUrl(urlObj, hosterDomain) {
    const path = urlObj.pathname || '/';
    const rule = this._getStrictHosterRule(hosterDomain);

    if (rule) {
      return this._isStrictFileUrl(urlObj, rule);
    }

    // Dedicated file hosters: a path is usually a shared file, but skip
    // obvious site pages such as /login, /pricing, or /article/....
    if (path === '/' || path === '') {
      return this._hasShareQuery(urlObj) || this._hasShareHash(urlObj);
    }

    const segments = path.split('/').filter(Boolean);
    const first = (segments[0] || '').toLowerCase();
    const last = (segments[segments.length - 1] || '').toLowerCase();
    if (segments.length === 1 && this._navigationPaths.has(first) && !this._hasShareQuery(urlObj)) {
      return false;
    }
    if (this._navigationPaths.has(first) && !this._fileRouteWords.has(first) && !this._hasShareQuery(urlObj)) {
      return false;
    }
    if (this._navigationPaths.has(last) && !this._fileRouteWords.has(last) && !this._hasShareQuery(urlObj)) {
      return false;
    }

    return true;
  },

  /**
   * Checks whether a URL is a downloadable hoster link rather than a hoster's
   * navigation, profile, repo, gallery, or search page.
   */
  isDownloadableHosterUrl(urlStr, supportedHosters) {
    if (!urlStr || typeof urlStr !== 'string') return false;
    const { hosterSet } = this._getHosterLookup(supportedHosters);
    if (hosterSet.size === 0) return false;

    try {
      const urlObj = new URL(urlStr);
      const hosterDomain = this._getMatchingHosterDomain(urlObj.hostname, hosterSet);
      if (!hosterDomain) return false;
      return this._isDownloadableHosterUrl(urlObj, hosterDomain);
    } catch (e) {
      return false;
    }
  },

  /**
   * True when a hostname belongs to a hoster that also has non-file pages
   * (GitHub repos, drive roots, document viewers).
   */
  isGeneralHosterDomain(hostname, supportedHosters) {
    const { hosterSet } = this._getHosterLookup(supportedHosters);
    const hosterDomain = this._getMatchingHosterDomain(hostname, hosterSet);
    return Boolean(this._getStrictHosterRule(hosterDomain));
  },

  _matchDownloadableHosterUrl(urlObj, hosterSet) {
    const hosterDomain = this._getMatchingHosterDomain(urlObj.hostname, hosterSet);
    if (!hosterDomain) return null;
    if (!this._isDownloadableHosterUrl(urlObj, hosterDomain)) return null;
    return this.normalizeUrl(urlObj.href);
  },

  /**
   * Extracts a supported TorBox URL from a string (links, redirectors, magnets).
   */
  extractSupportedUrl(urlStr, supportedHosters) {
    if (!urlStr || typeof urlStr !== 'string') return null;
    const trimmed = urlStr.trim();
    if (!trimmed) return null;

    // 1. Direct Magnet / Torrent / Usenet link
    if (trimmed.startsWith('magnet:?')) {
      const hash = this.extractMagnetHash(trimmed);
      return hash ? trimmed : null;
    }
    if (trimmed.toLowerCase().endsWith('.torrent') || trimmed.toLowerCase().endsWith('.nzb')) {
      return trimmed;
    }

    const { hosterSet } = this._getHosterLookup(supportedHosters);
    if (hosterSet.size === 0) return null;

    // 2. Direct URL parse
    try {
      const urlObj = new URL(trimmed);
      const directMatch = this._matchDownloadableHosterUrl(urlObj, hosterSet);
      if (directMatch) {
        return directMatch;
      }

      // Check query parameters for embedded target URLs (e.g. ?url=https%3A%2F%2F1fichier...)
      for (const [, val] of urlObj.searchParams.entries()) {
        if (!val || typeof val !== 'string') continue;
        let decVal = val;
        try { decVal = decodeURIComponent(val); } catch (e) {}

        if (decVal.startsWith('http://') || decVal.startsWith('https://')) {
          try {
            const nestedObj = new URL(decVal);
            const nestedMatch = this._matchDownloadableHosterUrl(nestedObj, hosterSet);
            if (nestedMatch) {
              return nestedMatch;
            }
          } catch (e) {}
        }
      }
    } catch (e) {
      // not a standard direct URL
    }

    // 3. Fallback: Scan decoded string for any embedded supported hoster URL
    let decoded = trimmed;
    try { decoded = decodeURIComponent(trimmed); } catch (e) {}

    const matches = decoded.match(/https?:\/\/[^\s"'<>\\]+/gi);
    if (matches) {
      for (const m of matches) {
        try {
          const nestedUrl = new URL(m);
          const nestedMatch = this._matchDownloadableHosterUrl(nestedUrl, hosterSet);
          if (nestedMatch) {
            return nestedMatch;
          }
        } catch (e) {}
      }
    }

    return null;
  },

  /**
   * Scans text content for plaintext magnet links and supported hoster URLs.
   */
  findLinksInText(text, supportedHosters) {
    if (!text || typeof text !== 'string' || text.length < 10) return [];
    const results = [];
    const seen = new Set();

    // 1. Scan for magnet links: magnet:\?xt=urn:btih:[a-zA-Z0-9]+[^\s"'<>]*
    const magnetMatches = text.match(/magnet:\?xt=urn:btih:[a-zA-Z0-9]+[^\s"'<>]*/gi);
    if (magnetMatches) {
      for (const mag of magnetMatches) {
        const normalized = this.normalizeUrl(mag);
        if (!seen.has(normalized)) {
          seen.add(normalized);
          results.push({ url: normalized, type: 'magnet' });
        }
      }
    }

    // 2. Scan for hoster URLs using compiled regex
    const { regex, hosterSet } = this._getHosterLookup(supportedHosters);
    if (regex) {
      const urlMatches = text.match(regex);
      if (urlMatches) {
        for (const urlStr of urlMatches) {
          try {
            const parsed = new URL(urlStr);
            const normalized = this._matchDownloadableHosterUrl(parsed, hosterSet);
            if (normalized && !seen.has(normalized)) {
              seen.add(normalized);
              results.push({ url: normalized, type: 'webdl' });
            }
          } catch (e) {}
        }
      }
    }

    return results;
  },

  /**
   * Extracts the torrent info hash (40-char hex BTIH) from a magnet link.
   */
  extractMagnetHash(url) {
    if (!url || !url.startsWith('magnet:')) return null;
    const match = url.match(/xt=urn:btih:([a-zA-Z0-9]+)/i);
    if (!match) return null;
    let hash = match[1].toLowerCase();
    
    // If base32 (32 chars), convert to 40 char hex if possible
    if (hash.length === 32) {
      hash = this._base32ToHex(hash);
    }
    return hash;
  },

  /**
   * Alias for extractMagnetHash.
   */
  extractHashFromMagnet(url) {
    return this.extractMagnetHash(url);
  },

  /**
   * Helper to decode Base32 BTIH hash to standard 40-char Hex.
   */
  _base32ToHex(base32) {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
    let bits = '';
    for (let i = 0; i < base32.length; i++) {
      const val = alphabet.indexOf(base32.charAt(i).toLowerCase());
      if (val === -1) return base32; // fallback
      bits += val.toString(2).padStart(5, '0');
    }
    let hex = '';
    for (let i = 0; i + 4 <= bits.length; i += 4) {
      hex += parseInt(bits.substring(i, i + 4), 2).toString(16);
    }
    return hex.substring(0, 40);
  },

  /**
   * Extracts display name (dn parameter) from magnet link.
   */
  extractMagnetName(url) {
    if (!url || !url.startsWith('magnet:')) return null;
    try {
      const params = new URLSearchParams(url.replace(/^magnet:\?/, ''));
      const dn = params.get('dn');
      if (dn) return decodeURIComponent(dn);
    } catch (e) {}
    const match = url.match(/dn=([^&]+)/i);
    return match ? decodeURIComponent(match[1].replace(/\+/g, ' ')) : null;
  },

  /**
   * Formats bytes into a human-readable string (e.g. 1.45 GB).
   */
  formatBytes(bytes, decimals = 2) {
    if (bytes === 0 || !bytes) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  },

  /**
   * Formats download speed (e.g. 12.4 MB/s).
   */
  formatSpeed(bytesPerSec) {
    if (!bytesPerSec || bytesPerSec <= 0) return '0 KB/s';
    return this.formatBytes(bytesPerSec, 1) + '/s';
  },

  /**
   * Formats a timestamp or date string into a relative time (e.g. "5m ago").
   */
  formatTimeAgo(dateInput) {
    if (!dateInput) return '';
    const date = new Date(dateInput);
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const intervals = [
      { label: 'y', seconds: 31536000 },
      { label: 'mo', seconds: 2592000 },
      { label: 'd', seconds: 86400 },
      { label: 'h', seconds: 3600 },
      { label: 'm', seconds: 60 }
    ];
    for (const interval of intervals) {
      const count = Math.floor(seconds / interval.seconds);
      if (count >= 1) return `${count}${interval.label} ago`;
    }
    return 'just now';
  },

  /**
   * Checks if a filename, release title, magnet name, or URL represents a video or audio media item.
   */
  isVideoOrAudio(filenameOrUrl) {
    if (!filenameOrUrl || typeof filenameOrUrl !== 'string') return false;
    return this.isVideo(filenameOrUrl) || this.isAudio(filenameOrUrl);
  },

  /**
   * Checks if a string represents a video file or video release (movies, TV shows, anime).
   */
  isVideo(filenameOrUrl) {
    if (!filenameOrUrl || typeof filenameOrUrl !== 'string') return false;
    const str = filenameOrUrl.trim().toLowerCase();

    // Exclude obvious software executables / documents
    if (/\.(exe|msi|dmg|pkg|apk|pdf|docx|xlsx|epub|txt)(\b|[?#&._-]|$)/i.test(str)) {
      return false;
    }

    // 1. Direct Video File Extensions anywhere in the string
    const videoExtRegex = /\.(mp4|mkv|avi|webm|mov|m4v|wmv|flv|ts|m2ts|vob|3gp|ogv|divx|xvid)(\b|[?#&._-]|$)/i;
    if (videoExtRegex.test(str)) return true;

    // 2. Video Quality, Scene, and Codec Release Keywords
    const videoKeywordsRegex = /\b(1080p|720p|2160p|480p|576p|4k|uhd|bluray|blu-ray|bdrip|brrip|web-?dl|webrip|web-rip|hdtv|hd-?tv|dvdrip|dvd-?rip|x264|x265|h\.?264|h\.?265|hevc|avc|10bit|remux|s\d{1,2}e\d{1,2}|season\s*\d+|episode\s*\d+|complete\s*series|extended\s*cut|directors\s*cut)\b/i;
    if (videoKeywordsRegex.test(str)) return true;

    // 3. Magnet DN extraction check
    if (str.startsWith('magnet:')) {
      const dn = this.extractMagnetName(filenameOrUrl);
      if (dn && dn !== filenameOrUrl) {
        if (this.isVideo(dn)) return true;
      }
    }

    return false;
  },

  /**
   * Checks if a string represents pure audio (music albums, tracks, podcasts, audiobooks).
   */
  isAudio(filenameOrUrl) {
    if (!filenameOrUrl || typeof filenameOrUrl !== 'string') return false;
    const str = filenameOrUrl.trim().toLowerCase();

    // Exclude obvious software / documents
    if (/\.(exe|msi|dmg|pkg|apk|pdf|docx|xlsx|epub|txt)(\b|[?#&._-]|$)/i.test(str)) {
      return false;
    }

    // If it has video indicators, it's a video release (e.g. video with AAC audio)
    if (this.isVideo(filenameOrUrl)) return false;

    // 1. Pure Audio Extensions
    const audioExtRegex = /\.(mp3|flac|wav|m4a|ogg|opus|alac|ape|aiff|wma|aac)(\b|[?#&._-]|$)/i;
    if (audioExtRegex.test(str)) return true;

    // 2. Music / Album Release Keywords & bracketed tags
    const audioKeywordsRegex = /(\[flac\]|\[mp3\]|\b320kbps\b|\b256kbps\b|\bflac\s*album\b|\bdiscography\b|\bost\b|\bsoundtrack\b|\baudiobook\b)/i;
    if (audioKeywordsRegex.test(str)) return true;

    if (str.startsWith('magnet:')) {
      const dn = this.extractMagnetName(filenameOrUrl);
      if (dn && dn !== filenameOrUrl) {
        if (this.isAudio(dn)) return true;
      }
    }

    return false;
  },

  /**
   * Extracts clean extension from filename.
   */
  getFileExtension(filename) {
    if (!filename || typeof filename !== 'string') return '';
    const parts = filename.split('?')[0].split('#')[0].split('.');
    return parts.length > 1 ? parts.pop().toLowerCase() : '';
  },

  /**
   * Debounces execution of a function.
   */
  debounce(func, wait) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TorBoxUtils;
} else if (typeof window !== 'undefined') {
  window.TorBoxUtils = TorBoxUtils;
} else if (typeof globalThis !== 'undefined') {
  globalThis.TorBoxUtils = TorBoxUtils;
}
