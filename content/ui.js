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
        padding: 4px 8px;
        border-radius: 6px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: 11px;
        font-weight: 600;
        color: #f8fafc;
        background: #1e293b;
        border: 1px solid #334155;
        cursor: default;
        user-select: none;
        transition: all 0.2s ease;
        line-height: 1.2;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
      }
      .tb-badge svg {
        width: 14px;
        height: 14px;
        margin-right: 4px;
      }
      .tb-badge.checking { border-color: #64748b; }
      .tb-badge.cached { background: #064e3b; border-color: #059669; color: #34d399; }
      .tb-badge.not-cached { opacity: 0.8; }
      .tb-badge.error { background: #7f1d1d; border-color: #dc2626; color: #fca5a5; }
      
      .tb-dl-btn {
        margin-left: 6px;
        padding: 4px 8px;
        border-radius: 6px;
        background: #2563eb;
        color: white;
        border: 1px solid #1d4ed8;
        cursor: pointer;
        font-size: 11px;
        font-weight: bold;
        transition: background 0.2s;
        display: inline-flex;
        align-items: center;
      }
      .tb-dl-btn svg {
        width: 12px;
        height: 12px;
        margin-right: 4px;
      }
      .tb-dl-btn:hover {
        background: #1d4ed8;
      }
      .tb-dl-btn.downloading {
        background: #475569;
        border-color: #334155;
        cursor: not-allowed;
      }
    `;

    const badge = document.createElement('span');
    badge.className = 'tb-badge checking';
    badge.innerHTML = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg> Checking...`;

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
        badge.innerHTML = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg> Checking...`;
        break;
      case window.TorBoxConstants.STATES.CACHED:
        badge.classList.add('cached');
        badge.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg> Cached`;
        
        // Add download button
        const dlBtn = document.createElement('button');
        dlBtn.className = 'tb-dl-btn';
        dlBtn.innerHTML = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg> DL`;
        dlBtn.title = 'Download instantly with TorBox';
        
        dlBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          
          if (dlBtn.classList.contains('downloading')) return;
          
          dlBtn.classList.add('downloading');
          dlBtn.innerHTML = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg> ...`;
          
          chrome.runtime.sendMessage({
            action: window.TorBoxConstants.MESSAGES.DOWNLOAD_CACHED,
            url: url
          }, (response) => {
            if (response && response.success && response.downloadUrl) {
              dlBtn.innerHTML = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg> Started`;
              dlBtn.style.background = '#059669';
              dlBtn.style.borderColor = '#047857';
              dlBtn.title = 'Download started';
              
              // Trigger a normal browser download so IDM and other managers can intercept it
              const a = document.createElement('a');
              a.href = response.downloadUrl;
              a.style.display = 'none';
              document.body.appendChild(a);
              a.click();
              setTimeout(() => a.remove(), 1000);
            } else {
              dlBtn.innerHTML = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg> Failed`;
              dlBtn.style.background = '#dc2626';
              dlBtn.style.borderColor = '#b91c1c';
              dlBtn.title = response ? response.error : 'Unknown error';
              dlBtn.classList.remove('downloading');
            }
          });
        });
        
        shadow.appendChild(dlBtn);
        break;
      case window.TorBoxConstants.STATES.NOT_CACHED:
        badge.classList.add('not-cached');
        badge.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/></svg> Not cached`;
        
        const uploadBtn = document.createElement('button');
        uploadBtn.className = 'tb-dl-btn';
        uploadBtn.style.background = '#7c3aed';
        uploadBtn.style.borderColor = '#6d28d9';
        uploadBtn.innerHTML = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path></svg> To TB`;
        uploadBtn.title = 'Download to TorBox';
        
        uploadBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          
          if (uploadBtn.classList.contains('downloading')) return;
          
          uploadBtn.classList.add('downloading');
          uploadBtn.innerHTML = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg> ...`;
          
          chrome.runtime.sendMessage({
            action: window.TorBoxConstants.MESSAGES.CREATE_WEBDL,
            url: url
          }, (response) => {
            if (response && response.success) {
              uploadBtn.innerHTML = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg> Added`;
              uploadBtn.style.background = '#059669';
              uploadBtn.style.borderColor = '#047857';
              uploadBtn.title = 'Added to TorBox';
            } else {
              uploadBtn.innerHTML = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg> Failed`;
              uploadBtn.style.background = '#dc2626';
              uploadBtn.style.borderColor = '#b91c1c';
              uploadBtn.title = response ? response.error : 'Unknown error';
              uploadBtn.classList.remove('downloading');
            }
          });
        });
        
        shadow.appendChild(uploadBtn);
        break;
      case window.TorBoxConstants.STATES.ERROR:
        badge.classList.add('error');
        badge.innerHTML = `<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg> Check failed`;
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
