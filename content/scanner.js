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

    // 1. Check article / card container
    const container = node.closest('article, .post, .entry, .item, .torrent-item, .card, .topic, .box');
    if (container) {
      const titleEl = container.querySelector('h1, h2, h3, h4, .entry-title, .post-title, .title, .subject');
      if (titleEl && titleEl.textContent.trim()) {
        return titleEl.textContent.trim().substring(0, 80);
      }
    }

    // 2. Preceding headings
    const headings = document.querySelectorAll('h1, h2, h3, h4, h5');
    let closestHeading = null;
    const ignoreWords = ['download', 'mirror', 'link', 'description', 'screenshot', 'comment', 'share', 'nav'];

    for (const h of headings) {
      if (h.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) {
        const text = h.textContent.trim().toLowerCase();
        const isIgnored = ignoreWords.some(w => text === w || text.startsWith(w + ':'));
        if (text && !isIgnored && text.length > 2) {
          closestHeading = h;
        }
      } else {
        break;
      }
    }

    if (closestHeading && closestHeading.textContent.trim()) {
      return closestHeading.textContent.trim().substring(0, 80);
    }

    // 3. Fallback: Page title
    let titleStr = document.title || '';
    if (titleStr.includes(' - ')) titleStr = titleStr.split(' - ')[0];
    else if (titleStr.includes(' | ')) titleStr = titleStr.split(' | ')[0];

    return titleStr.trim() || 'Page Links';
  }

  async init() {
    // 1. Load user settings
    const stored = await chrome.storage.local.get([
      'autoScan',
      'scanTextLinks',
      'showUncached',
      'showErrors',
      'displayMode',
      'showStreamIndicator',
      'customExcludedDomains'
    ]);

    if (stored.autoScan !== undefined) this.settings.autoScan = stored.autoScan;
    if (stored.scanTextLinks !== undefined) this.settings.scanTextLinks = stored.scanTextLinks;
    if (stored.showUncached !== undefined) this.settings.showUncached = stored.showUncached;
    if (stored.showErrors !== undefined) this.settings.showErrors = stored.showErrors;
    if (stored.displayMode !== undefined) this.settings.displayMode = stored.displayMode;
    if (stored.showStreamIndicator !== undefined) this.settings.showStreamIndicator = stored.showStreamIndicator;

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
              if (node.classList && (node.classList.contains('torbox-indicator-host') || node.id === 'torbox-stream-indicator')) {
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

    if (this.settings.displayMode === 'buttons') {
      window.torBoxUI.createIndicator(domElement, normalizedUrl);
    }

    this.pendingChecks.push({ element: domElement, url: normalizedUrl });
    this.processPendingChecks();
  }

  checkCurrentPage() {
    if (!this.settings.showStreamIndicator) return;

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
        if (window.torBoxUI) window.torBoxUI.removeStreamIndicator();
        return;
      }

      chrome.runtime.sendMessage({
        action: window.TorBoxConstants.MESSAGES.CHECK_CACHE,
        urls: [currentUrl]
      }, (response) => {
        if (response && response.results) {
          const state = response.results[currentUrl] || window.TorBoxConstants.STATES.NOT_CACHED;
          if (window.torBoxUI) {
            window.torBoxUI.createStreamIndicator(currentUrl, state);
          }
        }
      });
    } else {
      if (window.torBoxUI) window.torBoxUI.removeStreamIndicator();
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

        if (this.settings.displayMode === 'buttons') {
          if (state === window.TorBoxConstants.STATES.NOT_CACHED && !this.settings.showUncached) {
            window.torBoxUI.removeIndicator(item.element);
            continue;
          }
          if (state === window.TorBoxConstants.STATES.ERROR && !this.settings.showErrors) {
            window.torBoxUI.removeIndicator(item.element);
            continue;
          }
          window.torBoxUI.updateIndicator(item.element, state);
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
