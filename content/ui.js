/**
 * TorBox In-Page UI Controller
 * Renders shadow DOM badges, action buttons, and floating debrid widget.
 */

class TorBoxUI {
  constructor() {
    this.indicators = new Map(); // domElement -> { container, shadow, badge, url }
    this.streamIndicator = null;
  }

  createIndicator(domElement, url) {
    if (this.indicators.has(domElement)) return;

    // Remove any previous orphaned indicator attached after this element
    let sibling = domElement.nextSibling;
    while (sibling) {
      if (sibling.nodeType === Node.TEXT_NODE && !sibling.textContent.trim()) {
        sibling = sibling.nextSibling;
        continue;
      }
      if (sibling.nodeType === Node.ELEMENT_NODE && sibling.classList.contains('torbox-indicator-host')) {
        sibling.remove();
      }
      break;
    }

    const container = document.createElement('span');
    container.className = 'torbox-indicator-host';
    container.dataset.url = url;

    // Attach Shadow DOM for CSS isolation
    const shadow = container.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = `
      :host {
        all: initial;
        display: inline-block;
        vertical-align: middle;
        margin-left: 6px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      }
      .tb-wrapper {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        vertical-align: middle;
      }
      .tb-badge {
        display: inline-flex;
        align-items: center;
        padding: 3px 7px;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 600;
        color: #f8fafc;
        background: #0f172a;
        border: 1px solid #334155;
        cursor: default;
        user-select: none;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        line-height: 1.2;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
      }
      .tb-badge svg {
        width: 12px;
        height: 12px;
        margin-right: 4px;
        flex-shrink: 0;
      }
      .tb-badge.checking {
        border-color: #475569;
        color: #94a3b8;
      }
      .tb-badge.cached {
        background: rgba(6, 78, 59, 0.9);
        border-color: #059669;
        color: #34d399;
      }
      .tb-badge.not-cached {
        background: rgba(30, 41, 59, 0.9);
        border-color: #475569;
        color: #94a3b8;
      }
      .tb-badge.error {
        background: rgba(127, 29, 29, 0.9);
        border-color: #dc2626;
        color: #fca5a5;
      }
      
      .tb-btn {
        display: inline-flex;
        align-items: center;
        padding: 3px 8px;
        border-radius: 6px;
        font-size: 11px;
        font-weight: 700;
        cursor: pointer;
        border: 1px solid transparent;
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        box-shadow: 0 1px 3px rgba(0,0,0,0.3);
        outline: none;
        user-select: none;
      }
      .tb-btn svg {
        width: 12px;
        height: 12px;
        margin-right: 3px;
      }
      .tb-btn-dl {
        background: #10b981;
        color: #ffffff;
        border-color: #059669;
      }
      .tb-btn-dl:hover {
        background: #059669;
        transform: translateY(-1px);
        box-shadow: 0 2px 6px rgba(16, 185, 129, 0.4);
      }
      .tb-btn-cloud {
        background: #6366f1;
        color: #ffffff;
        border-color: #4f46e5;
      }
      .tb-btn-cloud:hover {
        background: #4f46e5;
        transform: translateY(-1px);
        box-shadow: 0 2px 6px rgba(99, 102, 241, 0.4);
      }
      .tb-btn.loading {
        background: #475569 !important;
        border-color: #334155 !important;
        cursor: not-allowed;
        transform: none !important;
      }
      .tb-spinner {
        animation: tb-spin 1s linear infinite;
      }
      @keyframes tb-spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    `;

    const wrapper = document.createElement('span');
    wrapper.className = 'tb-wrapper';

    const badge = document.createElement('span');
    badge.className = 'tb-badge checking';
    badge.innerHTML = `
      <svg class="tb-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" stroke-opacity="0.25"></circle>
        <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
      </svg> Checking
    `;

    wrapper.appendChild(badge);
    shadow.appendChild(style);
    shadow.appendChild(wrapper);

    // Insert directly after the target DOM element
    if (domElement.nextSibling) {
      domElement.parentNode.insertBefore(container, domElement.nextSibling);
    } else {
      domElement.parentNode.appendChild(container);
    }

    this.indicators.set(domElement, { container, shadow, wrapper, badge, url });
  }

  updateIndicator(domElement, state) {
    const data = this.indicators.get(domElement);
    if (!data) return;

    const { shadow, wrapper, badge, url } = data;

    // Clean up existing action buttons inside wrapper
    const oldBtn = wrapper.querySelector('.tb-btn');
    if (oldBtn) oldBtn.remove();

    badge.className = 'tb-badge';

    switch (state) {
      case window.TorBoxConstants.STATES.CHECKING:
        badge.classList.add('checking');
        badge.innerHTML = `
          <svg class="tb-spinner" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" stroke-opacity="0.25"></circle>
            <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg> Checking
        `;
        break;

      case window.TorBoxConstants.STATES.CACHED:
        badge.classList.add('cached');
        badge.innerHTML = `
          <svg viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/>
          </svg> Cached
        `;

        // Direct Download Action Button
        const dlBtn = document.createElement('button');
        dlBtn.className = 'tb-btn tb-btn-dl';
        dlBtn.title = 'Instant direct download with TorBox';
        dlBtn.innerHTML = `
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
          </svg> DL
        `;

        dlBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (dlBtn.classList.contains('loading')) return;

          dlBtn.classList.add('loading');
          dlBtn.innerHTML = `
            <svg class="tb-spinner" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" stroke-opacity="0.25"></circle>
              <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg> ...
          `;

          chrome.runtime.sendMessage({
            action: window.TorBoxConstants.MESSAGES.DOWNLOAD_CACHED,
            url: url
          }, (response) => {
            if (response && response.success && response.downloadUrl) {
              dlBtn.innerHTML = `
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path>
                </svg> Started
              `;
              dlBtn.style.background = '#059669';

              // Trigger click in webpage DOM so IDM and external download managers catch it
              if (response.engine !== 'browser') {
                const a = document.createElement('a');
                a.href = response.downloadUrl;
                a.style.display = 'none';
                document.body.appendChild(a);
                a.click();
                setTimeout(() => a.remove(), 1500);
              }
            } else {
              dlBtn.classList.remove('loading');
              dlBtn.innerHTML = `⚠️ Failed`;
              dlBtn.style.background = '#dc2626';
              dlBtn.title = response ? response.error : 'Download failed';
            }
          });
        });

        wrapper.appendChild(dlBtn);
        break;

      case window.TorBoxConstants.STATES.NOT_CACHED:
        badge.classList.add('not-cached');
        badge.innerHTML = `
          <svg viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/>
          </svg> Not cached
        `;

        const uploadBtn = document.createElement('button');
        uploadBtn.className = 'tb-btn tb-btn-cloud';
        uploadBtn.title = 'Add to TorBox cloud download queue';
        uploadBtn.innerHTML = `
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path>
          </svg> To TB
        `;

        uploadBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (uploadBtn.classList.contains('loading')) return;

          uploadBtn.classList.add('loading');
          uploadBtn.innerHTML = `
            <svg class="tb-spinner" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" stroke-opacity="0.25"></circle>
              <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg> ...
          `;

          const isMagnet = url.startsWith('magnet:?');
          const isUsenet = url.toLowerCase().endsWith('.nzb');
          const actionMsg = isMagnet
            ? window.TorBoxConstants.MESSAGES.CREATE_TORRENT
            : (isUsenet ? window.TorBoxConstants.MESSAGES.CREATE_USENET : window.TorBoxConstants.MESSAGES.CREATE_WEBDL);

          chrome.runtime.sendMessage({
            action: actionMsg,
            url: url
          }, (response) => {
            if (response && response.success) {
              uploadBtn.innerHTML = `
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path>
                </svg> Added
              `;
              uploadBtn.style.background = '#059669';
            } else {
              uploadBtn.classList.remove('loading');
              uploadBtn.innerHTML = `⚠️ Failed`;
              uploadBtn.style.background = '#dc2626';
              uploadBtn.title = response ? response.error : 'Failed to add to TorBox';
            }
          });
        });

        wrapper.appendChild(uploadBtn);
        break;

      case window.TorBoxConstants.STATES.ERROR:
        badge.classList.add('error');
        badge.innerHTML = `⚠️ Failed`;
        break;

      case window.TorBoxConstants.STATES.UNSUPPORTED:
        data.container.style.display = 'none';
        break;
    }
  }

  removeIndicator(domElement) {
    const data = this.indicators.get(domElement);
    if (data) {
      data.container.remove();
      this.indicators.delete(domElement);
    }
  }

  createStreamIndicator(url, state) {
    this.removeStreamIndicator();

    const container = document.createElement('div');
    container.id = 'torbox-stream-indicator';
    container.style.position = 'fixed';
    container.style.top = '24px';
    container.style.right = '24px';
    container.style.zIndex = '2147483647';

    document.body.appendChild(container);
    this.streamIndicator = container;

    const shadow = container.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      .tb-floating-panel {
        display: flex;
        align-items: center;
        gap: 8px;
        background: rgba(15, 23, 42, 0.92);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        padding: 8px 14px;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: #f8fafc;
        animation: tb-slide-in 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        user-select: none;
      }
      @keyframes tb-slide-in {
        from { opacity: 0; transform: translateY(-10px) scale(0.95); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      .tb-logo-badge {
        display: flex;
        align-items: center;
        gap: 6px;
        font-weight: 700;
        font-size: 13px;
        letter-spacing: -0.2px;
      }
      .tb-status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
      }
      .tb-status-dot.cached { background: #10b981; box-shadow: 0 0 8px #10b981; }
      .tb-status-dot.not-cached { background: #94a3b8; }
      
      .tb-action-btn {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 6px 12px;
        border-radius: 8px;
        font-size: 12px;
        font-weight: 700;
        border: none;
        cursor: pointer;
        transition: all 0.2s ease;
        color: white;
      }
      .tb-btn-dl {
        background: linear-gradient(135deg, #10b981, #059669);
        box-shadow: 0 2px 6px rgba(16, 185, 129, 0.3);
      }
      .tb-btn-dl:hover {
        background: linear-gradient(135deg, #059669, #047857);
        transform: translateY(-1px);
      }
      .tb-btn-cloud {
        background: linear-gradient(135deg, #6366f1, #4f46e5);
        box-shadow: 0 2px 6px rgba(99, 102, 241, 0.3);
      }
      .tb-btn-cloud:hover {
        background: linear-gradient(135deg, #4f46e5, #4338ca);
        transform: translateY(-1px);
      }
      .tb-close-btn {
        background: transparent;
        border: none;
        color: #94a3b8;
        cursor: pointer;
        padding: 4px 6px;
        border-radius: 6px;
        font-size: 14px;
        line-height: 1;
        transition: color 0.2s;
      }
      .tb-close-btn:hover {
        color: #ffffff;
        background: rgba(255, 255, 255, 0.1);
      }
    `;

    const isCached = state === window.TorBoxConstants.STATES.CACHED;
    const panel = document.createElement('div');
    panel.className = 'tb-floating-panel';

    const logoBadge = document.createElement('div');
    logoBadge.className = 'tb-logo-badge';
    logoBadge.innerHTML = `
      <span class="tb-status-dot ${isCached ? 'cached' : 'not-cached'}"></span>
      <span>${isCached ? 'TorBox Cached' : 'TorBox'}</span>
    `;

    panel.appendChild(logoBadge);

    if (isCached) {
      const dlBtn = document.createElement('button');
      dlBtn.className = 'tb-action-btn tb-btn-dl';
      dlBtn.innerHTML = '⚡ Instant DL';
      dlBtn.addEventListener('click', () => {
        dlBtn.textContent = '⏳ Starting...';
        chrome.runtime.sendMessage({
          action: window.TorBoxConstants.MESSAGES.DOWNLOAD_CACHED,
          url: url
        }, (res) => {
          if (res && res.success && res.downloadUrl) {
            dlBtn.textContent = '✔️ Downloading';
            if (res.engine !== 'browser') {
              const a = document.createElement('a');
              a.href = res.downloadUrl;
              a.style.display = 'none';
              document.body.appendChild(a);
              a.click();
              setTimeout(() => a.remove(), 1500);
            }
          } else {
            dlBtn.textContent = '⚠️ Failed';
          }
        });
      });
      panel.appendChild(dlBtn);
    } else {
      const cloudBtn = document.createElement('button');
      cloudBtn.className = 'tb-action-btn tb-btn-cloud';
      cloudBtn.innerHTML = '☁️ Add to TorBox';
      cloudBtn.addEventListener('click', () => {
        cloudBtn.textContent = '⏳ Adding...';
        chrome.runtime.sendMessage({
          action: window.TorBoxConstants.MESSAGES.CREATE_WEBDL,
          url: url
        }, (res) => {
          if (res && res.success) {
            cloudBtn.textContent = '✔️ Added';
          } else {
            cloudBtn.textContent = '⚠️ Failed';
          }
        });
      });
      panel.appendChild(cloudBtn);
    }

    const closeBtn = document.createElement('button');
    closeBtn.className = 'tb-close-btn';
    closeBtn.innerHTML = '✕';
    closeBtn.title = 'Dismiss';
    closeBtn.addEventListener('click', () => this.removeStreamIndicator());
    panel.appendChild(closeBtn);

    let hideTimeout = setTimeout(() => this.removeStreamIndicator(), 6000);
    panel.addEventListener('mouseenter', () => {
      if (hideTimeout) clearTimeout(hideTimeout);
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
