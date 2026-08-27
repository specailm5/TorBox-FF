class TorBoxUI {
  constructor() {
    this.indicators = new Map(); // url -> indicator element
    this.streamIndicator = null;
  }

  createIndicator(linkElement, url) {
    if (this.indicators.has(linkElement)) return; // Already has an indicator

    // We don't want to break the original site. 
    // We'll append a span right after the link.
    const container = document.createElement('span');
    container.className = 'torbox-indicator-host';
    container.style.display = 'inline-block';
    container.style.marginLeft = '8px';
    container.style.verticalAlign = 'middle';
    
    // Create Shadow DOM to isolate styles
    const shadow = container.attachShadow({ mode: 'closed' });
    
    const style = document.createElement('style');
    style.textContent = `
      .tb-badge {
        display: inline-flex;
        align-items: center;
        padding: 2px 6px;
        border-radius: 4px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: 11px;
        font-weight: 500;
        color: #fff;
        background: #444;
        cursor: default;
        user-select: none;
        transition: all 0.2s ease;
        line-height: 1.2;
      }
      .tb-badge.checking { background: #6b7280; }
      .tb-badge.cached { background: #10b981; }
      .tb-badge.not-cached { background: #374151; opacity: 0.8; }
      .tb-badge.error { background: #ef4444; }
      
      .tb-dl-btn {
        margin-left: 4px;
        padding: 2px 6px;
        border-radius: 4px;
        background: #3b82f6;
        color: white;
        border: none;
        cursor: pointer;
        font-size: 11px;
        font-weight: bold;
        transition: background 0.2s;
      }
      .tb-dl-btn:hover {
        background: #2563eb;
      }
      .tb-dl-btn.downloading {
        background: #6b7280;
        cursor: not-allowed;
      }
    `;

    const badge = document.createElement('span');
    badge.className = 'tb-badge checking';
    badge.textContent = '⏳ Checking...';

    shadow.appendChild(style);
    shadow.appendChild(badge);

    // Insert after the link
    if (linkElement.nextSibling) {
      linkElement.parentNode.insertBefore(container, linkElement.nextSibling);
    } else {
      linkElement.parentNode.appendChild(container);
    }

    this.indicators.set(linkElement, { container, shadow, badge, url });
  }

  updateIndicator(linkElement, state) {
    const data = this.indicators.get(linkElement);
    if (!data) return;
    
    const { shadow, badge, url } = data;
    
    // Clear old download buttons
    const oldBtn = shadow.querySelector('.tb-dl-btn');
    if (oldBtn) oldBtn.remove();

    badge.className = 'tb-badge';
    
    switch(state) {
      case window.TorBoxConstants.STATES.CHECKING:
        badge.classList.add('checking');
        badge.textContent = '⏳ Checking...';
        break;
      case window.TorBoxConstants.STATES.CACHED:
        badge.classList.add('cached');
        badge.textContent = '🟢 Cached';
        
        // Add download button
        const dlBtn = document.createElement('button');
        dlBtn.className = 'tb-dl-btn';
        dlBtn.innerHTML = '⚡ DL';
        dlBtn.title = 'Download instantly with TorBox';
        
        dlBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          
          if (dlBtn.classList.contains('downloading')) return;
          
          dlBtn.classList.add('downloading');
          dlBtn.textContent = '⏳ ...';
          
          chrome.runtime.sendMessage({
            action: window.TorBoxConstants.MESSAGES.DOWNLOAD_CACHED,
            url: url
          }, (response) => {
            if (response && response.success && response.downloadUrl) {
              dlBtn.textContent = '✔️ Started';
              dlBtn.style.background = '#10b981';
              dlBtn.title = 'Download started';
              
              // Trigger a normal browser download so IDM and other managers can intercept it
              const a = document.createElement('a');
              a.href = response.downloadUrl;
              a.style.display = 'none';
              document.body.appendChild(a);
              a.click();
              setTimeout(() => a.remove(), 1000);
            } else {
              dlBtn.textContent = '⚠️ Failed';
              dlBtn.style.background = '#ef4444';
              dlBtn.title = response ? response.error : 'Unknown error';
              dlBtn.classList.remove('downloading');
            }
          });
        });
        
        shadow.appendChild(dlBtn);
        break;
      case window.TorBoxConstants.STATES.NOT_CACHED:
        badge.classList.add('not-cached');
        badge.textContent = '⚫ Not cached';
        
        const uploadBtn = document.createElement('button');
        uploadBtn.className = 'tb-dl-btn';
        uploadBtn.style.background = '#8b5cf6';
        uploadBtn.innerHTML = '☁️ DL to TB';
        uploadBtn.title = 'Download to TorBox';
        
        uploadBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          
          if (uploadBtn.classList.contains('downloading')) return;
          
          uploadBtn.classList.add('downloading');
          uploadBtn.textContent = '⏳ ...';
          
          chrome.runtime.sendMessage({
            action: window.TorBoxConstants.MESSAGES.CREATE_WEBDL,
            url: url
          }, (response) => {
            if (response && response.success) {
              uploadBtn.textContent = '✔️ Added';
              uploadBtn.style.background = '#10b981';
              uploadBtn.title = 'Added to TorBox';
            } else {
              uploadBtn.textContent = '⚠️ Failed';
              uploadBtn.style.background = '#ef4444';
              uploadBtn.title = response ? response.error : 'Unknown error';
              uploadBtn.classList.remove('downloading');
            }
          });
        });
        
        shadow.appendChild(uploadBtn);
        break;
      case window.TorBoxConstants.STATES.ERROR:
        badge.classList.add('error');
        badge.textContent = '⚠️ Check failed';
        break;
      case window.TorBoxConstants.STATES.UNSUPPORTED:
        // Optional: hide or remove for unsupported
        data.container.style.display = 'none';
        break;
    }
  }

  removeIndicator(linkElement) {
    const data = this.indicators.get(linkElement);
    if (data) {
      data.container.remove();
      this.indicators.delete(linkElement);
    }
  }

  createStreamIndicator(url, state) {
    this.removeStreamIndicator(); // Clean up existing

    const container = document.createElement('div');
    container.id = 'torbox-stream-indicator';
    container.style.position = 'fixed';
    container.style.top = '20px';
    container.style.right = '20px';
    container.style.zIndex = '999999';
    container.style.pointerEvents = 'auto'; // allow clicking

    document.body.appendChild(container);

    this.streamIndicator = container;

    const shadow = container.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      .tb-stream-panel {
        display: flex;
        align-items: center;
        background: rgba(17, 24, 39, 0.9);
        backdrop-filter: blur(8px);
        padding: 6px 12px;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.5);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
        color: white;
      }
      .tb-badge {
        font-size: 13px;
        font-weight: 600;
        margin-right: 8px;
      }
      .tb-badge.cached { color: #34d399; }
      .tb-badge.not-cached { color: #9ca3af; }
      
      .tb-action-btn {
        padding: 4px 10px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: bold;
        border: none;
        cursor: pointer;
        transition: background 0.2s;
        color: white;
      }
      .tb-btn-dl { background: #3b82f6; }
      .tb-btn-dl:hover { background: #2563eb; }
      .tb-btn-dl.loading { background: #6b7280; cursor: not-allowed; }
      
      .tb-btn-upload { background: #8b5cf6; }
      .tb-btn-upload:hover { background: #7c3aed; }
      .tb-btn-upload.loading { background: #6b7280; cursor: not-allowed; }
      
      .tb-close-btn {
        margin-left: 8px;
        background: transparent;
        border: none;
        color: #9ca3af;
        cursor: pointer;
        font-size: 18px;
        line-height: 1;
        padding: 0 4px;
        transition: color 0.2s;
      }
      .tb-close-btn:hover {
        color: white;
      }
    `;
    
    const panel = document.createElement('div');
    panel.className = 'tb-stream-panel';
    
    const badge = document.createElement('div');
    badge.className = 'tb-badge';
    
    if (state === window.TorBoxConstants.STATES.CACHED) {
      badge.textContent = '🟢 TorBox Cached';
      badge.classList.add('cached');
      
      const dlBtn = document.createElement('button');
      dlBtn.className = 'tb-action-btn tb-btn-dl';
      dlBtn.innerHTML = '⚡ DL';
      dlBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (dlBtn.classList.contains('loading')) return;
        dlBtn.classList.add('loading');
        dlBtn.textContent = '⏳ ...';
        
        chrome.runtime.sendMessage({
          action: window.TorBoxConstants.MESSAGES.DOWNLOAD_CACHED,
          url: url
        }, (res) => {
          if (res && res.success) {
            dlBtn.textContent = '✔️ Started';
            dlBtn.style.background = '#10b981';
            const a = document.createElement('a');
            a.href = res.downloadUrl;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            setTimeout(() => a.remove(), 1000);
          } else {
            dlBtn.textContent = '⚠️ Failed';
            dlBtn.style.background = '#ef4444';
            dlBtn.classList.remove('loading');
          }
        });
      });
      panel.appendChild(badge);
      panel.appendChild(dlBtn);
    } else {
      badge.textContent = '⚪ Not cached';
      badge.classList.add('not-cached');
      
      const uploadBtn = document.createElement('button');
      uploadBtn.className = 'tb-action-btn tb-btn-upload';
      uploadBtn.innerHTML = '☁️ DL to TB';
      uploadBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (uploadBtn.classList.contains('loading')) return;
        uploadBtn.classList.add('loading');
        uploadBtn.textContent = '⏳ Requesting...';
        
        chrome.runtime.sendMessage({
          action: window.TorBoxConstants.MESSAGES.CREATE_WEBDL,
          url: url
        }, (res) => {
          if (res && res.success) {
            uploadBtn.textContent = '✔️ Added to TorBox';
            uploadBtn.style.background = '#10b981';
          } else {
            uploadBtn.textContent = '⚠️ Failed';
            uploadBtn.style.background = '#ef4444';
            uploadBtn.classList.remove('loading');
          }
        });
      });
      panel.appendChild(badge);
      panel.appendChild(uploadBtn);
    }
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'tb-close-btn';
    closeBtn.innerHTML = '&times;';
    closeBtn.title = 'Close indicator';
    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.removeStreamIndicator();
    });
    panel.appendChild(closeBtn);

    // Auto-hide after 5 seconds, cancel if hovered
    let hideTimer = setTimeout(() => {
      this.removeStreamIndicator();
    }, 5000);
    
    panel.addEventListener('mouseenter', () => {
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
    });

    shadow.appendChild(style);
    shadow.appendChild(panel);
  }

  removeStreamIndicator() {
    if (this.streamIndicator) {
      this.streamIndicator.remove();
      this.streamIndicator = null;
    }
  }
}

window.torBoxUI = new TorBoxUI();
