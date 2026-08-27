class TorBoxScanner {
  constructor() {
    this.hosters = [];
    this.streams = [];
    this.scannedLinks = new Set();
    this.pendingChecks = [];
    this.pageLinks = new Map(); // Stores { url, state, originalUrl }
    this.settings = Object.assign({}, window.TorBoxConstants.DEFAULT_SETTINGS);
    
    // Bind debounced check
    this.processPendingChecks = window.TorBoxUtils.debounce(this._processPendingChecks.bind(this), 500);
    this._setupMessageListener();
  }

  _setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === window.TorBoxConstants.MESSAGES.GET_PAGE_LINKS) {
        // Convert Map to array
        const linksList = Array.from(this.pageLinks.values());
        sendResponse({ links: linksList });
        return true;
      }
    });
  }

  _getNearestHeading(node) {
    // 1. Try to find the article/post container and its primary title
    let container = node.closest('article, .post, .entry, .item, .type-post');
    if (container) {
      const titleElement = container.querySelector('h1, h2, h3, .entry-title, .post-title');
      if (titleElement && titleElement.textContent.trim()) {
        return titleElement.textContent.trim();
      }
    }

    // 2. Fallback to nearest preceding heading, but skip generic subheadings
    const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    let closestHeading = null;
    const ignoreWords = ['download', 'mirror', 'link', 'description', 'feature', 'requirement', 'screenshot', 'trailer', 'comment', 'repack', 'install'];
    
    for (const h of headings) {
      if (h.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) {
        const text = h.textContent.trim().toLowerCase();
        // Skip generic subheadings often found inside posts
        const isIgnored = ignoreWords.some(w => text.includes(w)) && text.length < 30;
        if (text && !isIgnored) {
          closestHeading = h;
        }
      } else {
        break; // passed the node
      }
    }
    
    if (closestHeading && closestHeading.textContent.trim()) {
      return closestHeading.textContent.trim();
    }
    
    // 3. Fallback to page title
    let titleStr = document.title;
    if (titleStr.includes('-')) titleStr = titleStr.split('-')[0].trim();
    else if (titleStr.includes('|')) titleStr = titleStr.split('|')[0].trim();
    
    return titleStr || 'Page Links';
  }

  async init() {
    // 1. Get settings
    const keys = await chrome.storage.local.get(['autoScan', 'showUncached', 'showErrors', 'displayMode']);
    if (keys.autoScan !== undefined) this.settings.autoScan = keys.autoScan;
    if (keys.showUncached !== undefined) this.settings.showUncached = keys.showUncached;
    if (keys.showErrors !== undefined) this.settings.showErrors = keys.showErrors;
    if (keys.displayMode !== undefined) this.settings.displayMode = keys.displayMode;

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
        
        // Track the link
        if (!this.pageLinks.has(normalizedUrl)) {
          this.pageLinks.set(normalizedUrl, { 
            url: normalizedUrl, 
            originalUrl: href,
            text: link.textContent.trim() || link.title || '',
            group: this._getNearestHeading(link),
            state: window.TorBoxConstants.STATES.CHECKING 
          });
        }
        
        if (this.settings.displayMode === 'buttons') {
          window.torBoxUI.createIndicator(link, normalizedUrl);
        }
        
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
      let cachedCount = 0;
      
      if (response && response.results) {
        for (const item of batch) {
          const state = response.results[item.url] || window.TorBoxConstants.STATES.ERROR;
          
          if (this.pageLinks.has(item.url)) {
            this.pageLinks.get(item.url).state = state;
          }
          
          if (this.settings.displayMode === 'buttons') {
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
        }
      } else {
        // Error
        for (const item of batch) {
          if (this.pageLinks.has(item.url)) {
            this.pageLinks.get(item.url).state = window.TorBoxConstants.STATES.ERROR;
          }
          
          if (this.settings.displayMode === 'buttons') {
            if (this.settings.showErrors) {
               window.torBoxUI.updateIndicator(item.link, window.TorBoxConstants.STATES.ERROR);
            } else {
               window.torBoxUI.removeIndicator(item.link);
            }
          }
        }
      }
      
      this._updateBadge();
    });
  }

  _updateBadge() {
    if (this.settings.displayMode !== 'list') return;
    
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
