/**
 * TorBox In-Page Link Scanner
 * Scans anchor elements and text containers for magnets and supported hosters.
 */

class TorBoxScanner {
  constructor() {
    this.hosters = [];
    this.streams = [];
    this.scannedElements = new WeakSet();
    this.pendingChecks = [];
    this.pageLinks = new Map(); // normalizedUrl -> { url, originalUrl, text, group, state, type }
    this.settings = Object.assign({}, window.TorBoxConstants.DEFAULT_SETTINGS);
    this.isHosterSite = false;

    // Debounced check batcher
    this.processPendingChecks = window.TorBoxUtils.debounce(this._processPendingChecks.bind(this), 400);
    this.debouncedScan = window.TorBoxUtils.debounce(this._scanFullDOM.bind(this), 300);
    this.debouncedUpdateBadge = window.TorBoxUtils.debounce(this._updateBadge.bind(this), 150);

    this._setupMessageListener();
  }

  _setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === window.TorBoxConstants.MESSAGES.GET_PAGE_LINKS) {
        const linksList = Array.from(this.pageLinks.values());
        sendResponse({ links: linksList });
        return true;
      }
    });
  }

  _getNearestHeading(node) {
    if (!node || !node.parentElement) return 'Page Links';

    const cleanTitle = (raw) => {
      if (!raw) return '';
      return raw
        .replace(/^permanent\s+link\s+to\s*:?\s*/i, '')
        .replace(/^comments?\s+on\s*:?\s*/i, '')
        .replace(/^download\s*:\s*/i, '')
        .replace(/\s+/g, ' ')
        .trim();
    };

    const isValidTitle = (str) => {
      if (!str || str.length < 3) return false;
      return /[a-zA-Z0-9]/.test(str);
    };

    // 1. Check article / card container (e.g. FitGirl, WordPress, DDL posts, forum topics)
    const container = node.closest('article, .post, .type-post, .entry, .item, .torrent-item, .card, .topic, .forum-post, .box, .release');
    if (container) {
      const titleEl = container.querySelector('.entry-title a, .entry-title, .post-title a, .post-title, a[rel="bookmark"], h1 a, h1, h2 a, h2, h3 a, h3, .title, .subject');
      if (titleEl && titleEl.textContent) {
        const cleaned = cleanTitle(titleEl.textContent);
        if (isValidTitle(cleaned)) {
          return cleaned.substring(0, 100);
        }
      }
    }

    // 2. Scan preceding headings, ignoring generic mirror/download/widget headers
    const headings = document.querySelectorAll('h1, h2, h3, h4, h5');
    let closestHeading = null;
    const ignoreWords = [
      'download', 'downloads', 'download mirrors', 'mirrors', 'mirror', 'filehoster',
      'filehosters', 'direct links', 'direct mirror', 'links', 'torrents', 'torrent',
      'magnet', 'magnets', 'description', 'screenshot', 'screenshots', 'comment',
      'comments', 'share', 'nav', 'navigation', 'system requirements', 'repack features',
      'features', 'discussion', 'nfo', 'info', 'trailer', 'video', 'changelog',
      'selective download', 'installation', 'how to install', 'included dlc',
      'search', 'recent posts', 'archives', 'categories', 'meta', 'tags', 'pages',
      'leave a reply', 'related posts', 'upcoming repacks'
    ];

    for (const h of headings) {
      if (h.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) {
        const rawText = h.textContent ? h.textContent.trim().toLowerCase() : '';
        const isIgnored = ignoreWords.some(w => rawText === w || rawText.startsWith(w + ':') || rawText.startsWith(w + ' -'));
        const cleaned = cleanTitle(h.textContent);
        if (!isIgnored && isValidTitle(cleaned)) {
          closestHeading = cleaned;
        }
      } else {
        break;
      }
    }

    if (closestHeading && isValidTitle(closestHeading)) {
      return closestHeading.substring(0, 100);
    }

    // 3. Fallback: Clean Document title
    let titleStr = document.title || '';
    if (titleStr.includes(' - ')) titleStr = titleStr.split(' - ')[0];
    else if (titleStr.includes(' | ')) titleStr = titleStr.split(' | ')[0];
    else if (titleStr.includes(' » ')) titleStr = titleStr.split(' » ')[0];

    const finalTitle = cleanTitle(titleStr);
    return isValidTitle(finalTitle) ? finalTitle : 'Page Links';
  }

  async init() {
    // 1. Load user settings
    const stored = await chrome.storage.local.get([
      'autoScan',
      'scanTextLinks',
      'showFloatingDock',
      'customExcludedDomains'
    ]);

    if (stored.autoScan !== undefined) this.settings.autoScan = stored.autoScan;
    if (stored.scanTextLinks !== undefined) this.settings.scanTextLinks = stored.scanTextLinks;
    if (stored.showFloatingDock !== undefined) this.settings.showFloatingDock = stored.showFloatingDock;

    // Check custom domain exclusion
    const currentHost = window.location.hostname.toLowerCase();
    const excludedDomains = stored.customExcludedDomains || [];
    if (excludedDomains.some(d => currentHost === d || currentHost.endsWith('.' + d))) {
      return;
    }

    if (!this.settings.autoScan) return;

    // 2. Fetch supported hosters
    chrome.runtime.sendMessage({ action: window.TorBoxConstants.MESSAGES.GET_HOSTERS }, (response) => {
      if (response && response.hosters && response.hosters.length > 0) {
        this.hosters = response.hosters;
        this.streams = response.streams || [];
      } else {
        this.hosters = window.TorBoxConstants.DEFAULT_HOSTERS || [];
        this.streams = window.TorBoxConstants.DEFAULT_STREAMS || [];
      }

      this.isHosterSite = this.hosters.some(h => {
        if (!h) return false;
        const lower = h.toLowerCase();
        return currentHost === lower || currentHost.endsWith('.' + lower);
      });

      this.startScanning();
    });
  }

  startScanning() {
    this._scanFullDOM();
    this.checkCurrentPage();

    let lastHref = location.href;

    // Setup MutationObserver for dynamic websites / SPAs
    const observer = new MutationObserver((mutations) => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        this.checkCurrentPage();
      }

      let hasNewNodes = false;
      for (const m of mutations) {
        if (m.type === 'childList' && m.addedNodes.length > 0) {
          for (const node of m.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              if (node.id === 'torbox-floating-dock') {
                continue;
              }
              hasNewNodes = true;
              break;
            }
          }
        }
        if (hasNewNodes) break;
      }

      if (hasNewNodes) {
        this.debouncedScan();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  _scanFullDOM() {
    if (!this.isHosterSite) {
      this.scanAnchors(document.body);
      if (this.settings.scanTextLinks) {
        this.scanTextContainers(document.body);
      }
    }
  }

  scanAnchors(rootNode) {
    if (!rootNode) return;
    const links = rootNode.tagName === 'A' ? [rootNode] : rootNode.querySelectorAll('a');

    for (const link of links) {
      if (this.scannedElements.has(link)) continue;
      this.scannedElements.add(link);

      const href = link.href;
      if (!href || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('#')) {
        continue;
      }

      const extractedUrl = window.TorBoxUtils.extractSupportedUrl(href, this.hosters);
      if (extractedUrl) {
        this._registerLink(link, extractedUrl, href, 'anchor');
      }
    }
  }

  scanTextContainers(rootNode) {
    if (!rootNode) return;
    const containers = rootNode.querySelectorAll('p, pre, code, blockquote, td, li, .post-body, .messageContent, .entry-content');

    for (const container of containers) {
      if (this.scannedElements.has(container)) continue;
      this.scannedElements.add(container);

      // Check text length to avoid scanning huge containers
      const text = container.textContent;
      if (!text || text.length < 10 || text.length > 50000) continue;

      const foundLinks = window.TorBoxUtils.findLinksInText(text, this.hosters);
      for (const item of foundLinks) {
        this._registerLink(container, item.url, item.url, 'text');
      }
    }
  }

  _registerLink(domElement, normalizedUrl, originalUrl, scanSource) {
    const isMagnet = normalizedUrl.startsWith('magnet:?');
    let linkText = '';

    if (isMagnet) {
      linkText = window.TorBoxUtils.extractMagnetName(normalizedUrl) || 'Magnet Download';
    } else if (domElement.tagName === 'A') {
      linkText = (domElement.textContent || domElement.title || '').trim();
    }

    if (!linkText) {
      try {
        const parsed = new URL(normalizedUrl);
        const filename = parsed.pathname.split('/').filter(Boolean).pop();
        linkText = filename ? decodeURIComponent(filename) : parsed.hostname;
      } catch (e) {
        linkText = normalizedUrl;
      }
    }

    if (!this.pageLinks.has(normalizedUrl)) {
      this.pageLinks.set(normalizedUrl, {
        url: normalizedUrl,
        originalUrl: originalUrl,
        text: linkText,
        group: this._getNearestHeading(domElement),
        state: window.TorBoxConstants.STATES.CHECKING,
        type: isMagnet ? 'torrent' : (normalizedUrl.endsWith('.nzb') ? 'usenet' : 'webdl')
      });
    }

    this.pendingChecks.push({ element: domElement, url: normalizedUrl });
    this.processPendingChecks();
    this.debouncedUpdateBadge();
  }

  checkCurrentPage() {
    const currentUrl = window.location.href;
    let hostname;
    try {
      hostname = new URL(currentUrl).hostname.toLowerCase();
    } catch (e) {
      return;
    }

    const isStreamSite = this.streams && this.streams.some(streamHost => {
      if (!streamHost) return false;
      const lower = streamHost.toLowerCase();
      return hostname === lower || hostname.endsWith('.' + lower);
    });

    if (isStreamSite || this.isHosterSite) {
      const urlObj = new URL(currentUrl);
      if (urlObj.pathname === '/' && urlObj.search === '' && !urlObj.hash) {
        return;
      }

      let linkTitle = document.title ? document.title.split(' - ')[0].split(' | ')[0].split(' » ')[0].trim() : hostname;
      if (!linkTitle || linkTitle.length < 2) linkTitle = hostname;

      if (!this.pageLinks.has(currentUrl)) {
        this.pageLinks.set(currentUrl, {
          url: currentUrl,
          originalUrl: currentUrl,
          text: linkTitle,
          group: isStreamSite ? 'Stream Video' : 'File Download',
          state: window.TorBoxConstants.STATES.CHECKING,
          type: 'webdl'
        });

        this.pendingChecks.push({ element: document.body, url: currentUrl });
        this.processPendingChecks();
        this.debouncedUpdateBadge();
      }
    }
  }

  _processPendingChecks() {
    if (this.pendingChecks.length === 0) return;

    const batch = [...this.pendingChecks];
    this.pendingChecks = [];
    const urls = batch.map(item => item.url);

    chrome.runtime.sendMessage({
      action: window.TorBoxConstants.MESSAGES.CHECK_CACHE,
      urls: urls
    }, (response) => {
      const results = (response && response.results) ? response.results : {};

      for (const item of batch) {
        const state = results[item.url] || window.TorBoxConstants.STATES.NOT_CACHED;

        if (this.pageLinks.has(item.url)) {
          this.pageLinks.get(item.url).state = state;
        }
      }

      this._updateBadge();
    });
  }

  _updateBadge() {
    let cachedCount = 0;
    for (const linkData of this.pageLinks.values()) {
      if (linkData.state === window.TorBoxConstants.STATES.CACHED) {
        cachedCount++;
      }
    }

    chrome.runtime.sendMessage({
      action: window.TorBoxConstants.MESSAGES.UPDATE_BADGE,
      count: cachedCount
    });

    if (window.torBoxUI) {
      window.torBoxUI.updateFloatingDock(this.pageLinks, this.settings.showFloatingDock !== false);
    }
  }
}

// Instantiate on document ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.torBoxScanner = new TorBoxScanner();
    window.torBoxScanner.init();
  });
} else {
  window.torBoxScanner = new TorBoxScanner();
  window.torBoxScanner.init();
}
