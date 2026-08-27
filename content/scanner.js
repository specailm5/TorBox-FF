class TorBoxScanner {
  constructor() {
    this.hosters = [];
    this.streams = [];
    this.scannedLinks = new Set();
    this.pendingChecks = [];
    this.settings = Object.assign({}, window.TorBoxConstants.DEFAULT_SETTINGS);
    
    // Bind debounced check
    this.processPendingChecks = window.TorBoxUtils.debounce(this._processPendingChecks.bind(this), 500);
  }

  async init() {
    // 1. Get settings
    const keys = await chrome.storage.local.get(['autoScan', 'showUncached', 'showErrors']);
    if (keys.autoScan !== undefined) this.settings.autoScan = keys.autoScan;
    if (keys.showUncached !== undefined) this.settings.showUncached = keys.showUncached;
    if (keys.showErrors !== undefined) this.settings.showErrors = keys.showErrors;

    if (!this.settings.autoScan) return;

    // 2. Fetch supported hosters from background
    chrome.runtime.sendMessage({ action: window.TorBoxConstants.MESSAGES.GET_HOSTERS }, (response) => {
      if (response && response.hosters && response.hosters.length > 0) {
        this.hosters = response.hosters;
        this.streams = response.streams || [];
      } else {
        console.warn("TorBox Extension: Failed to load supported hosters from API. Falling back to default list.");
        this.hosters = window.TorBoxConstants.DEFAULT_HOSTERS || [];
        this.streams = window.TorBoxConstants.DEFAULT_STREAMS || [];
      }
      // Check if we are currently browsing a file hoster's own website
      const currentHost = window.location.hostname.toLowerCase();
      const isHosterSite = this.hosters.some(h => {
        if (!h) return false;
        const lowerHost = h.toLowerCase();
        return currentHost === lowerHost || currentHost.endsWith('.' + lowerHost);
      });
      
      if (isHosterSite) {
         console.log("TorBox Extension: Disabled DOM scanning on file hoster website to prevent UI spam. Floating widget is still active.");
      }

      this.startScanning(isHosterSite);
    });
  }

  startScanning(isHosterSite) {
    if (!isHosterSite) {
      this.scanDOM(document.body);
    }
    this.checkCurrentPage(isHosterSite);

    let lastUrl = location.href;

    // Setup MutationObserver for dynamic content
    const observer = new MutationObserver((mutations) => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        this.checkCurrentPage(isHosterSite);
      }

      if (!isHosterSite) {
        for (const mutation of mutations) {
          if (mutation.type === 'childList') {
            mutation.addedNodes.forEach(node => {
              if (node.nodeType === Node.ELEMENT_NODE) {
                this.scanDOM(node);
              }
            });
          }
        }
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  scanDOM(rootNode) {
    // Gather all <a> tags
    const links = rootNode.tagName === 'A' ? [rootNode] : rootNode.querySelectorAll('a');
    
    for (const link of links) {
      if (this.scannedLinks.has(link)) continue;
      this.scannedLinks.add(link);

      const href = link.href;
      if (!href || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('#')) {
        continue;
      }

      // 3. Filter the link: Extract supported TorBox link, bypassing redirectors if any
      const extractedUrl = window.TorBoxUtils.extractSupportedUrl(href, this.hosters);
      
      if (extractedUrl) {
        const normalizedUrl = window.TorBoxUtils.normalizeUrl(extractedUrl);
        window.torBoxUI.createIndicator(link, normalizedUrl);
        this.pendingChecks.push({ link, url: normalizedUrl });
        this.processPendingChecks();
      }
    }
  }

  checkCurrentPage(isHosterSite) {
    const currentUrl = window.location.href;
    let hostname;
    try {
      hostname = new URL(currentUrl).hostname.toLowerCase();
    } catch(e) { return; }

    const isStreamSite = this.streams && this.streams.some(streamHost => {
       if (!streamHost) return false;
       const lowerHost = streamHost.toLowerCase();
       return hostname === lowerHost || hostname.endsWith('.' + lowerHost);
    });

    if (isStreamSite || isHosterSite) {
       
       // Heuristic: Don't show the widget on the exact homepage of hosters/streams
       const urlObj = new URL(currentUrl);
       if (urlObj.pathname === '/' && urlObj.search === '' && !urlObj.hash) {
          if (window.torBoxUI && window.torBoxUI.removeStreamIndicator) {
             window.torBoxUI.removeStreamIndicator();
          }
          return;
       }

       chrome.runtime.sendMessage({
         action: window.TorBoxConstants.MESSAGES.CHECK_CACHE,
         urls: [currentUrl]
       }, (response) => {
          if (response && response.results) {
             const state = response.results[currentUrl] || window.TorBoxConstants.STATES.ERROR;
             window.torBoxUI.createStreamIndicator(currentUrl, state);
          }
       });
    } else {
       // If we navigated away from a supported site, remove any existing indicator
       if (window.torBoxUI && window.torBoxUI.removeStreamIndicator) {
         window.torBoxUI.removeStreamIndicator();
       }
    }
  }

  _processPendingChecks() {
    if (this.pendingChecks.length === 0) return;

    // Take current pending
    const batch = [...this.pendingChecks];
    this.pendingChecks = [];

    const urls = batch.map(item => item.url);

    chrome.runtime.sendMessage({
      action: window.TorBoxConstants.MESSAGES.CHECK_CACHE,
      urls: urls
    }, (response) => {
      if (response && response.results) {
        for (const item of batch) {
          const state = response.results[item.url] || window.TorBoxConstants.STATES.ERROR;
          
          // Apply visibility settings
          if (state === window.TorBoxConstants.STATES.NOT_CACHED && !this.settings.showUncached) {
            window.torBoxUI.removeIndicator(item.link);
            continue;
          }
          if (state === window.TorBoxConstants.STATES.ERROR && !this.settings.showErrors) {
            window.torBoxUI.removeIndicator(item.link);
            continue;
          }

          window.torBoxUI.updateIndicator(item.link, state);
        }
      } else {
        // Error
        for (const item of batch) {
          if (this.settings.showErrors) {
             window.torBoxUI.updateIndicator(item.link, window.TorBoxConstants.STATES.ERROR);
          } else {
             window.torBoxUI.removeIndicator(item.link);
          }
        }
      }
    });
  }
}

// Initialize when ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.torBoxScanner = new TorBoxScanner();
    window.torBoxScanner.init();
  });
} else {
  window.torBoxScanner = new TorBoxScanner();
  window.torBoxScanner.init();
}
