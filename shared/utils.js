const TorBoxUtils = {
  /**
   * Deduplicates an array of URLs.
   */
  deduplicateUrls(urls) {
    return [...new Set(urls.map(url => this.normalizeUrl(url)))];
  },

  /**
   * Normalizes a URL by removing trailing slashes and hashes.
   */
  normalizeUrl(urlStr) {
    try {
      const url = new URL(urlStr);
      // Remove hash
      url.hash = '';
      // Remove trailing slash if present
      let finalUrl = url.href;
      if (finalUrl.endsWith('/')) {
        finalUrl = finalUrl.slice(0, -1);
      }
      return finalUrl;
    } catch (e) {
      return urlStr;
    }
  },

  /**
   * Debounces a function.
   */
  debounce(func, wait) {
    let timeout;
    return function (...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  },

  /**
   * Extracts hostname from a URL string safely.
   */
  getHostname(urlStr) {
    try {
      const url = new URL(urlStr);
      return url.hostname;
    } catch (e) {
      return null;
    }
  },

  /**
   * Helper to hash an array of URLs to MD5 comma-separated string.
   */
  hashUrls(urls) {
    // Assuming md5 is available globally or imported
    return urls.map(url => md5(url)).join(',');
  },

  /**
   * Extracts a supported TorBox URL from a string, handling redirectors.
   * Returns the extracted URL or null if none found.
   */
  extractSupportedUrl(urlStr, supportedHosters) {
    if (!supportedHosters || supportedHosters.length === 0) return null;

    try {
      if (urlStr.startsWith('magnet:?') || urlStr.endsWith('.torrent') || urlStr.endsWith('.nzb')) {
        return urlStr;
      }

      // Try decoding in case it's in a query param (e.g. ?url=https%3A%2F%2F1fichier...)
      let decodedUrl = urlStr;
      try { decodedUrl = decodeURIComponent(urlStr); } catch (e) {}

      for (const host of supportedHosters) {
        if (!host) continue;
        const lowerHost = host.toLowerCase();

        // If the host is anywhere in the string
        if (decodedUrl.toLowerCase().includes(lowerHost)) {
          // 1. Direct hostname match
          try {
            const urlObj = new URL(urlStr);
            if (urlObj.hostname.toLowerCase() === lowerHost || urlObj.hostname.toLowerCase().endsWith('.' + lowerHost)) {
              return urlStr; // It's a direct, clean link
            }
          } catch (e) {}

          // 2. Redirector match: Find the actual https://...host... URL embedded in the string
          // This regex looks for http:// or https:// followed by anything, the host, and then URL characters
          const escapedHost = lowerHost.replace(/\./g, '\\.');
          const regex = new RegExp(`https?://([^"'>\\s]+)?${escapedHost}[^"'>\\s]*`, 'i');
          const match = decodedUrl.match(regex);
          if (match) {
            return match[0];
          }
        }
      }
    } catch (e) {}
    
    return null;
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TorBoxUtils;
} else if (typeof window !== 'undefined') {
  window.TorBoxUtils = TorBoxUtils;
}
