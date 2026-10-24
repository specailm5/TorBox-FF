/**
 * TorBox In-Page UI Controller
 * - Floating dock summarizing detected links, with a 1-click download drawer.
 * - Values from the host page are escaped before they enter the drawer markup.
 */

class TorBoxUI {
  constructor() {
    this.streamIndicator = null;
    this.floatingDock = null;
    this.floatingDockShadow = null;
    this.dockMinimized = false;
    this.dockDismissed = false;
    this.openDrawerGroups = new Set();

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !this.floatingDockShadow) return;
      const drawer = this.floatingDockShadow.querySelector('.tb-dock-drawer');
      if (drawer && !drawer.hidden) {
        this._setDrawerOpen(false);
      }
    });
  }

  // Stubs in case called from elsewhere
  createIndicator() {}
  updateIndicator() {}
  removeIndicator() {}
  createStreamIndicator() {}
  removeStreamIndicator() {}

  _escapeHtml(value) {
    if (!value) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  _setDrawerOpen(open) {
    if (!this.floatingDockShadow) return;
    const drawer = this.floatingDockShadow.querySelector('.tb-dock-drawer');
    const toggle = this.floatingDockShadow.querySelector('#dockToggleBtn');
    if (!drawer) return;

    const active = this.floatingDockShadow.activeElement;
    drawer.hidden = !open;
    if (toggle) {
      toggle.setAttribute('aria-expanded', String(open));
      toggle.textContent = open ? 'Close' : 'View';
      if (!open && active && drawer.contains(active)) {
        toggle.focus();
      }
    }
    if (open && this.floatingDock && this.floatingDock._renderDrawer) {
      this.floatingDock._renderDrawer();
    }
  }

  /**
   * Floating quick-action dock and drawer, anchored bottom right of the page.
   */
  updateFloatingDock(pageLinksMap, enabled = true) {
    if (!enabled) {
      this.removeFloatingDock();
      return;
    }

    const links = Array.from(pageLinksMap.values());
    if (links.length < 1) {
      this.removeFloatingDock();
      return;
    }

    if (this.dockDismissed) return;

    let cachedCount = 0;
    let checkingCount = 0;
    links.forEach(l => {
      if (l.state === window.TorBoxConstants.STATES.CACHED) cachedCount++;
      else if (l.state === window.TorBoxConstants.STATES.CHECKING) checkingCount++;
    });

    const groups = {};
    links.forEach(l => {
      let g = (l.group && l.group.trim()) || 'Page links';
      if (g.length < 2 || !/[a-zA-Z0-9]/.test(g)) {
        g = 'Page links';
      }
      if (!groups[g]) groups[g] = [];
      groups[g].push(l);
    });

    const getLinkPriority = (l) => {
      if (l.state === window.TorBoxConstants.STATES.CACHED) return 1;
      if (l.state === window.TorBoxConstants.STATES.CHECKING) return 2;
      if (l.state === window.TorBoxConstants.STATES.NOT_CACHED) return 3;
      if (l.state === window.TorBoxConstants.STATES.ERROR) return 4;
      return 5;
    };

    Object.keys(groups).forEach(g => {
      groups[g].sort((a, b) => getLinkPriority(a) - getLinkPriority(b));
    });

    const sortedGroupNames = Object.keys(groups)
      .filter(g => g && g.trim().length >= 2 && groups[g].length > 0)
      .sort((a, b) => {
        const getGroupScore = (gName) => {
          const gLinks = groups[gName] || [];
          if (gLinks.some(l => l.state === window.TorBoxConstants.STATES.CACHED)) return 2;
          if (gLinks.some(l => l.state === window.TorBoxConstants.STATES.CHECKING)) return 1;
          return 0;
        };
        return getGroupScore(b) - getGroupScore(a);
      });

    const linkLabel = links.length === 1 ? 'link' : 'links';
    const statHtml = checkingCount > 0 && cachedCount === 0
      ? `${links.length} ${linkLabel} (checking)`
      : `${links.length} ${linkLabel} (<strong>${cachedCount} cached</strong>)`;

    if (!this.floatingDock) {
      const container = document.createElement('div');
      container.id = 'torbox-floating-dock';
      container.style.position = 'fixed';
      container.style.bottom = '20px';
      container.style.right = '20px';
      container.style.zIndex = '2147483646';

      const shadow = container.attachShadow({ mode: 'open' });
      this.floatingDockShadow = shadow;

      const style = document.createElement('style');
      style.textContent = `
        :host {
          all: initial;
        }
        * {
          box-sizing: border-box;
        }
        .tb-dock-wrapper {
          display: flex;
          flex-direction: column-reverse;
          align-items: flex-end;
          gap: 8px;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
          font-size: 12px;
          line-height: 1.4;
          color: #ffffff;
        }
        button {
          font-family: inherit;
        }
        button:focus-visible {
          outline: 2px solid #04bf8a;
          outline-offset: 2px;
        }
        .tb-dock-pill {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 8px 6px 10px;
          background: #12141b;
          border: 1px solid #302f2f;
          border-radius: 8px;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
        }
        .tb-dock-brand {
          font-size: 12px;
          font-weight: 600;
          color: #ffffff;
        }
        .tb-dock-stat {
          font-size: 11px;
          color: #9ca3af;
        }
        .tb-dock-stat strong {
          color: #04bf8a;
          font-weight: 600;
        }
        .tb-dock-toggle-btn {
          display: inline-flex;
          align-items: center;
          min-height: 24px;
          padding: 3px 8px;
          background: #04bf8a;
          border: 1px solid #04bf8a;
          border-radius: 6px;
          color: #04120d;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
        }
        .tb-dock-toggle-btn:hover {
          background: #03a878;
          border-color: #03a878;
        }
        .tb-dock-close {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 24px;
          min-height: 24px;
          padding: 0 4px;
          background: transparent;
          border: 1px solid transparent;
          border-radius: 4px;
          color: #9ca3af;
          font-size: 14px;
          line-height: 1.2;
          cursor: pointer;
        }
        .tb-dock-close:hover {
          color: #ffffff;
          border-color: #302f2f;
        }

        .tb-dock-drawer {
          width: 380px;
          max-width: calc(100vw - 32px);
          max-height: min(500px, 75vh);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          background: #12141b;
          border: 1px solid #302f2f;
          border-radius: 12px;
          box-shadow: 0 18px 40px rgba(0, 0, 0, 0.55);
        }
        .tb-dock-drawer[hidden] {
          display: none;
        }
        .tb-drawer-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 9px 12px;
          border-bottom: 1px solid #302f2f;
          flex-shrink: 0;
        }
        .tb-drawer-title {
          font-size: 12px;
          font-weight: 600;
          color: #ffffff;
        }
        .tb-drawer-count {
          font-size: 11px;
          color: #04bf8a;
        }
        .tb-drawer-scroll {
          flex: 1;
          min-height: 0;
          overflow-y: auto;
          overscroll-behavior: contain;
          padding: 8px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          background: #0f1117;
          scrollbar-width: thin;
          scrollbar-color: #454545 transparent;
        }
        .tb-drawer-scroll::-webkit-scrollbar,
        .tb-group-body::-webkit-scrollbar {
          width: 6px;
        }
        .tb-drawer-scroll::-webkit-scrollbar-thumb,
        .tb-group-body::-webkit-scrollbar-thumb {
          background: #454545;
          border-radius: 3px;
        }
        .tb-drawer-footer {
          flex-shrink: 0;
          padding: 6px 10px;
          border-top: 1px solid #302f2f;
          background: #12141b;
          text-align: right;
        }
        .tb-drawer-exclude-btn {
          display: inline-flex;
          align-items: center;
          min-height: 24px;
          padding: 2px 4px;
          background: transparent;
          border: none;
          color: #9ca3af;
          font-size: 10px;
          line-height: 1.4;
          cursor: pointer;
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .tb-drawer-exclude-btn:hover {
          color: #ffffff;
        }
        .tb-drawer-group {
          flex-shrink: 0;
          overflow: hidden;
          background: #1e2129;
          border: 1px solid #302f2f;
          border-radius: 8px;
        }
        .tb-drawer-group.has-cached {
          border-color: rgba(4, 191, 138, 0.4);
        }
        .tb-group-header-btn {
          width: 100%;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 8px;
          padding: 8px 10px;
          background: transparent;
          border: none;
          color: #ffffff;
          font-size: 11px;
          text-align: left;
          cursor: pointer;
        }
        .tb-group-header-btn:hover {
          background: rgba(255, 255, 255, 0.04);
        }
        .tb-group-title {
          flex: 1;
          min-width: 0;
          font-size: 11px;
          font-weight: 600;
          color: #d1d5db;
          line-height: 1.4;
          word-break: break-word;
        }
        .tb-group-meta {
          display: flex;
          align-items: center;
          gap: 5px;
          flex-shrink: 0;
        }
        .tb-group-badge {
          padding: 0 4px;
          border: 1px solid rgba(4, 191, 138, 0.4);
          border-radius: 4px;
          background: rgba(4, 191, 138, 0.1);
          color: #04bf8a;
          font-size: 9px;
          font-weight: 600;
          white-space: nowrap;
        }
        .tb-group-count {
          padding: 0 4px;
          border: 1px solid #302f2f;
          border-radius: 4px;
          color: #9ca3af;
          font-size: 9px;
        }
        .tb-group-chevron {
          color: #9ca3af;
          font-size: 8px;
          transition: transform 0.15s ease;
        }
        .tb-drawer-group.open .tb-group-chevron {
          transform: rotate(180deg);
        }
        .tb-group-body {
          display: none;
          flex-direction: column;
          gap: 4px;
          max-height: 280px;
          overflow-y: auto;
          overscroll-behavior: contain;
          padding: 4px 8px;
          background: #0f1117;
          border-top: 1px solid #302f2f;
        }
        .tb-drawer-group.open .tb-group-body {
          display: flex;
        }
        .tb-link-row {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 8px;
          padding: 5px 0;
          border-bottom: 1px solid #302f2f;
        }
        .tb-link-row:last-child {
          border-bottom: none;
        }
        .tb-link-name {
          flex: 1;
          min-width: 0;
          color: #d1d5db;
          font-size: 10px;
          line-height: 1.4;
          word-break: break-word;
        }
        .tb-link-name.cached {
          color: #04bf8a;
          font-weight: 500;
        }
        .tb-link-btns {
          display: flex;
          gap: 4px;
          flex-shrink: 0;
        }
        .tb-mini-btn {
          padding: 2px 7px;
          border: 1px solid transparent;
          border-radius: 4px;
          background: #04bf8a;
          color: #04120d;
          font-size: 9px;
          font-weight: 600;
          cursor: pointer;
          white-space: nowrap;
        }
        .tb-mini-btn:hover {
          background: #03a878;
        }
        .tb-mini-btn.cloud {
          background: transparent;
          border-color: #302f2f;
          color: #d1d5db;
        }
        .tb-mini-btn.cloud:hover {
          border-color: #454545;
          color: #ffffff;
        }
        .tb-mini-btn.is-error {
          background: transparent;
          border-color: rgba(239, 68, 68, 0.45);
          color: #ef4444;
        }
        .tb-mini-btn.is-success {
          background: #04bf8a;
          border-color: #04bf8a;
          color: #04120d;
        }
        @media (prefers-reduced-motion: reduce) {
          * {
            transition-duration: 0.01ms !important;
          }
        }
      `;

      const wrapper = document.createElement('div');
      wrapper.className = 'tb-dock-wrapper';

      const drawer = document.createElement('div');
      drawer.className = 'tb-dock-drawer';
      drawer.hidden = true;

      const pill = document.createElement('div');
      pill.className = 'tb-dock-pill';
      pill.innerHTML = `
        <span class="tb-dock-brand">TorBox</span>
        <span class="tb-dock-stat" id="dockStatText"></span>
        <button class="tb-dock-toggle-btn" id="dockToggleBtn" type="button" aria-expanded="false">View</button>
        <button class="tb-dock-close" id="dockCloseBtn" type="button" aria-label="Dismiss TorBox dock">×</button>
      `;

      wrapper.appendChild(pill);
      wrapper.appendChild(drawer);

      shadow.appendChild(style);
      shadow.appendChild(wrapper);
      (document.body || document.documentElement).appendChild(container);

      pill.addEventListener('click', (e) => {
        if (e.target.closest('#dockCloseBtn')) return;
        this._setDrawerOpen(drawer.hidden);
      });

      const closeBtn = pill.querySelector('#dockCloseBtn');
      if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.dismissDock();
        });
      }

      this.floatingDock = container;
    }

    const shadow = this.floatingDockShadow || this.floatingDock.shadowRoot;
    if (!shadow) return;

    const stat = shadow.querySelector('#dockStatText');
    if (stat) stat.innerHTML = statHtml;

    const drawer = shadow.querySelector('.tb-dock-drawer');
    const renderDrawer = () => {
      if (!drawer) return;
      const scrollEl = drawer.querySelector('.tb-drawer-scroll');
      const curScroll = scrollEl ? scrollEl.scrollTop : 0;

      let html = `
        <div class="tb-drawer-header">
          <span class="tb-drawer-title">Detected downloads</span>
          <span class="tb-drawer-count">${cachedCount} cached</span>
        </div>
        <div class="tb-drawer-scroll">
      `;

      sortedGroupNames.forEach((gName) => {
        const groupLinks = groups[gName];
        const gCachedCount = groupLinks.filter(l => l.state === window.TorBoxConstants.STATES.CACHED).length;
        const isOpen = this.openDrawerGroups.has(gName);
        const safeGroup = this._escapeHtml(gName);

        html += `
          <div class="tb-drawer-group ${isOpen ? 'open' : ''} ${gCachedCount > 0 ? 'has-cached' : ''}" data-group="${safeGroup}">
            <button class="tb-group-header-btn" type="button" aria-expanded="${isOpen}">
              <span class="tb-group-title" title="${safeGroup}">${safeGroup}</span>
              <span class="tb-group-meta">
                ${gCachedCount > 0 ? `<span class="tb-group-badge">${gCachedCount} cached</span>` : ''}
                <span class="tb-group-count">${groupLinks.length}</span>
                <span class="tb-group-chevron" aria-hidden="true">▼</span>
              </span>
            </button>
            <div class="tb-group-body">
              ${groupLinks.map(l => {
                const isCached = l.state === window.TorBoxConstants.STATES.CACHED;
                const safeUrl = this._escapeHtml(l.url);
                const label = this._escapeHtml(l.text || l.url);
                return `
                  <div class="tb-link-row">
                    <span class="tb-link-name ${isCached ? 'cached' : ''}" title="${safeUrl}">${label}</span>
                    <span class="tb-link-btns">
                      ${isCached ? `
                        <button class="tb-mini-btn btn-dock-dl" type="button" data-url="${safeUrl}" title="Download this cached file">Download</button>
                      ` : `
                        <button class="tb-mini-btn cloud btn-dock-cloud" type="button" data-url="${safeUrl}" title="Add to your TorBox cloud">Add to TorBox</button>
                      `}
                    </span>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
      });

      html += `
        </div>
        <div class="tb-drawer-footer">
          <button class="tb-drawer-exclude-btn" id="dockExcludeBtn" type="button" title="Stop scanning and hide the TorBox dock on this site">Don't show on this site</button>
        </div>
      `;
      drawer.innerHTML = html;

      const newScrollEl = drawer.querySelector('.tb-drawer-scroll');
      if (newScrollEl) newScrollEl.scrollTop = curScroll;

      drawer.querySelectorAll('.tb-group-header-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const groupEl = btn.closest('.tb-drawer-group');
          if (!groupEl) return;
          const gName = groupEl.dataset.group;
          const willOpen = !groupEl.classList.contains('open');
          groupEl.classList.toggle('open', willOpen);
          btn.setAttribute('aria-expanded', String(willOpen));
          if (gName) {
            if (willOpen) this.openDrawerGroups.add(gName);
            else this.openDrawerGroups.delete(gName);
          }
        });
      });

      drawer.querySelectorAll('.btn-dock-dl').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const url = btn.dataset.url;
          btn.textContent = 'Starting…';
          btn.disabled = true;
          chrome.runtime.sendMessage({ action: window.TorBoxConstants.MESSAGES.DOWNLOAD_CACHED, url }, (res) => {
            btn.disabled = false;
            if (res && res.success && res.downloadUrl) {
              if (res.engine !== 'browser') {
                const a = document.createElement('a');
                a.href = res.downloadUrl;
                a.style.display = 'none';
                document.body.appendChild(a);
                a.click();
                setTimeout(() => a.remove(), 1200);
              }
              btn.textContent = 'Started';
              btn.classList.add('is-success');
            } else {
              btn.textContent = 'Failed';
              btn.classList.add('is-error');
              btn.title = (res && res.error) ? res.error : 'Download failed';
            }
          });
        });
      });

      drawer.querySelectorAll('.btn-dock-cloud').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const url = btn.dataset.url;
          btn.textContent = 'Adding…';
          btn.disabled = true;
          const isMagnet = url.startsWith('magnet:?');
          const isTorrent = url.toLowerCase().endsWith('.torrent') || url.toLowerCase().includes('.torrent?');
          const isUsenet = url.toLowerCase().endsWith('.nzb') || url.toLowerCase().includes('.nzb?');

          let msg = window.TorBoxConstants.MESSAGES.CREATE_WEBDL;
          if (isMagnet || isTorrent) {
            msg = window.TorBoxConstants.MESSAGES.CREATE_TORRENT;
          } else if (isUsenet) {
            msg = window.TorBoxConstants.MESSAGES.CREATE_USENET;
          }

          chrome.runtime.sendMessage({ action: msg, url }, (res) => {
            btn.disabled = false;
            if (res && res.success) {
              btn.textContent = 'Added';
              btn.classList.add('is-success');
              btn.title = res.detail || 'Added to TorBox';
            } else {
              btn.textContent = 'Failed';
              btn.classList.add('is-error');
              btn.title = (res && res.error) ? res.error : 'Failed to add to TorBox';
            }
          });
        });
      });

      const excludeBtn = drawer.querySelector('#dockExcludeBtn');
      if (excludeBtn) {
        excludeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (window.torBoxScanner && typeof window.torBoxScanner.excludeCurrentSite === 'function') {
            window.torBoxScanner.excludeCurrentSite();
          } else {
            this.dismissDock();
          }
        });
      }
    };

    this.floatingDock._renderDrawer = renderDrawer;
    if (drawer && !drawer.hidden) {
      renderDrawer();
    }
  }

  removeFloatingDock() {
    if (this.floatingDock) {
      this.floatingDock.remove();
      this.floatingDock = null;
      this.floatingDockShadow = null;
      this.openDrawerGroups.clear();
    }
  }

  /**
   * Hides the dock for the rest of this page view. It stays hidden until the
   * page navigates or the user re-enables the site from the popup.
   */
  dismissDock() {
    this.dockDismissed = true;
    this.removeFloatingDock();
  }

  resetDockDismissal() {
    this.dockDismissed = false;
  }
}

window.torBoxUI = new TorBoxUI();
