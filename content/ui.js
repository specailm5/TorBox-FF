/**
 * TorBox In-Page UI Controller
 * - Floating Quick Action Dock summarizing found links with 1-click downloads drawer.
 * - Floating download widget on hoster landing pages.
 */

class TorBoxUI {
  constructor() {
    this.streamIndicator = null;
    this.floatingDock = null;
    this.dockMinimized = false;
    this.openDrawerGroups = new Set();
  }

  // Stubs in case called from elsewhere
  createIndicator() {}
  updateIndicator() {}
  removeIndicator() {}

  /**
   * Floating Quick-Action Dock & Drawer (bottom right of page)
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

    let cachedCount = 0;
    let checkingCount = 0;
    links.forEach(l => {
      if (l.state === window.TorBoxConstants.STATES.CACHED) cachedCount++;
      else if (l.state === window.TorBoxConstants.STATES.CHECKING) checkingCount++;
    });

    // Group links by release/game name and sort cached first
    const groups = {};
    links.forEach(l => {
      let g = (l.group && l.group.trim()) || 'Page Links';
      if (g.length < 2 || !/[a-zA-Z0-9]/.test(g)) {
        g = 'Page Links';
      }
      if (!groups[g]) groups[g] = [];
      groups[g].push(l);
    });

    // Helper for link sorting: cached first, then checking, then uncached, then errors
    const getLinkPriority = (l) => {
      if (l.state === window.TorBoxConstants.STATES.CACHED) return 1;
      if (l.state === window.TorBoxConstants.STATES.CHECKING) return 2;
      if (l.state === window.TorBoxConstants.STATES.NOT_CACHED) return 3;
      if (l.state === window.TorBoxConstants.STATES.ERROR) return 4;
      return 5;
    };

    // Sort links within each group (cached first)
    Object.keys(groups).forEach(g => {
      groups[g].sort((a, b) => getLinkPriority(a) - getLinkPriority(b));
    });

    // Sort group names so groups with cached links appear first
    const sortedGroupNames = Object.keys(groups)
      .filter(g => g && g.trim().length >= 2 && groups[g].length > 0)
      .sort((a, b) => {
        const getGroupScore = (gName) => {
          const gLinks = groups[gName] || [];
          const hasCached = gLinks.some(l => l.state === window.TorBoxConstants.STATES.CACHED);
          if (hasCached) return 2;
          const hasChecking = gLinks.some(l => l.state === window.TorBoxConstants.STATES.CHECKING);
          if (hasChecking) return 1;
          return 0;
        };
        return getGroupScore(b) - getGroupScore(a);
      });

    const statHtml = checkingCount > 0 && cachedCount === 0
      ? `${links.length} links (<span style="color:#60a5fa;">checking...</span>)`
      : `${links.length} links (<strong style="color:#10b981;">${cachedCount} cached</strong>)`;

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
        .tb-dock-wrapper {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 8px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          user-select: none;
        }
        .tb-dock-pill {
          display: flex;
          align-items: center;
          gap: 8px;
          background: rgba(15, 23, 42, 0.95);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          padding: 7px 14px;
          border-radius: 30px;
          border: 1px solid rgba(255, 255, 255, 0.15);
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
          color: #f8fafc;
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        }
        .tb-dock-pill:hover {
          background: rgba(30, 41, 59, 0.98);
          border-color: rgba(255, 255, 255, 0.25);
          transform: translateY(-1px);
        }
        .tb-dock-brand {
          display: flex;
          align-items: center;
          gap: 5px;
          font-weight: 800;
          font-size: 12px;
          color: #38bdf8;
        }
        .tb-dock-stat {
          font-size: 11px;
          color: #94a3b8;
        }
        .tb-dock-toggle-btn {
          background: rgba(59, 130, 246, 0.2);
          border: 1px solid rgba(59, 130, 246, 0.4);
          color: #60a5fa;
          font-size: 11px;
          font-weight: 700;
          padding: 3px 8px;
          border-radius: 12px;
          cursor: pointer;
        }
        .tb-dock-close {
          background: transparent;
          border: none;
          color: #64748b;
          cursor: pointer;
          font-size: 13px;
          padding: 2px 4px;
          line-height: 1;
        }
        .tb-dock-close:hover { color: #f8fafc; }

        /* Expanded Quick Drawer */
        .tb-dock-drawer {
          width: 380px;
          max-width: calc(100vw - 32px);
          height: 500px;
          max-height: 75vh;
          background: rgba(15, 23, 42, 0.98);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 14px;
          box-shadow: 0 16px 36px rgba(0, 0, 0, 0.6);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          animation: tb-slide-up 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes tb-slide-up {
          from { opacity: 0; transform: translateY(10px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .tb-drawer-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 14px;
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          font-size: 12px;
          font-weight: 700;
          color: #f8fafc;
          flex-shrink: 0;
        }
        .tb-drawer-scroll {
          flex: 1;
          min-height: 0;
          overflow-y: auto !important;
          overflow-x: hidden;
          padding: 10px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          overscroll-behavior: contain;
        }
        .tb-drawer-scroll::-webkit-scrollbar {
          width: 6px;
        }
        .tb-drawer-scroll::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.25);
          border-radius: 4px;
        }
        .tb-drawer-scroll::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.4);
        }
        .tb-drawer-group {
          background: rgba(30, 41, 59, 0.6);
          border-radius: 8px;
          border: 1px solid rgba(255, 255, 255, 0.06);
          overflow: hidden;
          flex-shrink: 0;
          transition: border-color 0.2s;
        }
        .tb-drawer-group.has-cached {
          border-color: rgba(16, 185, 129, 0.35);
        }
        .tb-group-header-btn {
          width: 100%;
          padding: 10px 12px;
          background: rgba(255, 255, 255, 0.03);
          border: none;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 8px;
          cursor: pointer;
          color: #f8fafc;
          text-align: left;
          transition: background 0.2s;
        }
        .tb-group-header-btn:hover {
          background: rgba(255, 255, 255, 0.07);
        }
        .tb-group-title {
          font-size: 12px;
          font-weight: 700;
          color: #f8fafc;
          line-height: 1.45;
          word-break: break-word;
          flex: 1;
        }
        .tb-group-meta {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-shrink: 0;
          margin-top: 2px;
        }
        .tb-group-badge {
          font-size: 9px;
          font-weight: 800;
          color: #34d399;
          background: rgba(16, 185, 129, 0.15);
          border: 1px solid rgba(16, 185, 129, 0.35);
          padding: 2px 6px;
          border-radius: 10px;
        }
        .tb-group-count {
          font-size: 9px;
          color: #94a3b8;
          background: rgba(255, 255, 255, 0.06);
          padding: 2px 6px;
          border-radius: 10px;
        }
        .tb-group-chevron {
          font-size: 8px;
          color: #64748b;
          transition: transform 0.2s;
        }
        .tb-drawer-group.open .tb-group-chevron {
          transform: rotate(180deg);
        }
        .tb-group-body {
          display: none;
          max-height: 280px;
          overflow-y: auto;
          overscroll-behavior: contain;
          padding: 6px 8px;
          background: rgba(0, 0, 0, 0.25);
          border-top: 1px solid rgba(255, 255, 255, 0.05);
          flex-direction: column;
          gap: 5px;
        }
        .tb-group-body::-webkit-scrollbar {
          width: 4px;
        }
        .tb-group-body::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2);
          border-radius: 4px;
        }
        .tb-drawer-group.open .tb-group-body {
          display: flex;
        }
        .tb-link-row {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 8px;
          font-size: 10px;
          padding: 5px 0;
          border-bottom: 1px solid rgba(255, 255, 255, 0.04);
        }
        .tb-link-row:last-child { border-bottom: none; }
        .tb-link-name {
          color: #cbd5e1;
          line-height: 1.35;
          word-break: break-word;
          flex: 1;
          min-width: 0;
        }
        .tb-link-name.cached {
          color: #34d399;
          font-weight: 600;
        }
        .tb-link-btns {
          display: flex;
          gap: 4px;
          flex-shrink: 0;
          margin-top: 1px;
        }
        .tb-mini-btn {
          padding: 3px 8px;
          border-radius: 5px;
          font-size: 10px;
          font-weight: 700;
          border: none;
          cursor: pointer;
          color: white;
          background: #10b981;
          transition: all 0.15s;
          flex-shrink: 0;
        }
        .tb-mini-btn:hover { background: #059669; }

        .tb-mini-btn.cloud { background: #6366f1; }
        .tb-mini-btn.cloud:hover { background: #4f46e5; }
      `;

      const wrapper = document.createElement('div');
      wrapper.className = 'tb-dock-wrapper';

      const drawer = document.createElement('div');
      drawer.className = 'tb-dock-drawer';
      drawer.style.display = 'none';

      const pill = document.createElement('div');
      pill.className = 'tb-dock-pill';
      pill.innerHTML = `
        <div class="tb-dock-brand"><span>⚡ TorBox</span></div>
        <div class="tb-dock-stat" id="dockStatText">${statHtml}</div>
        <button class="tb-dock-toggle-btn" id="dockToggleBtn">🔍 View</button>
        <button class="tb-dock-close" id="dockCloseBtn" title="Dismiss">✕</button>
      `;

      wrapper.appendChild(drawer);
      wrapper.appendChild(pill);

      shadow.appendChild(style);
      shadow.appendChild(wrapper);
      (document.body || document.documentElement).appendChild(container);

      // Pill toggle
      pill.addEventListener('click', (e) => {
        if (e.target.id === 'dockCloseBtn') return;
        const isHidden = drawer.style.display === 'none';
        drawer.style.display = isHidden ? 'flex' : 'none';
        if (isHidden && this.floatingDock && this.floatingDock._renderDrawer) {
          this.floatingDock._renderDrawer();
        }
      });

      const closeBtn = pill.querySelector('#dockCloseBtn');
      if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.removeFloatingDock();
        });
      }

      this.floatingDock = container;
    }

    // Dynamic drawer renderer using the latest data
    const shadow = this.floatingDockShadow || this.floatingDock.shadowRoot;
    if (shadow) {
      const stat = shadow.querySelector('#dockStatText');
      if (stat) {
        stat.innerHTML = statHtml;
      }

      const drawer = shadow.querySelector('.tb-dock-drawer');
      const renderDrawer = () => {
        if (!drawer) return;
        const scrollEl = drawer.querySelector('.tb-drawer-scroll');
        const curScroll = scrollEl ? scrollEl.scrollTop : 0;

        let html = `
          <div class="tb-drawer-header">
            <span>⚡ Detected Downloads</span>
            <span style="font-size:10px; color:#10b981;">${cachedCount} Cached</span>
          </div>
          <div class="tb-drawer-scroll">
        `;

        sortedGroupNames.forEach((gName) => {
          const groupLinks = groups[gName];
          const gCachedLinks = groupLinks.filter(l => l.state === window.TorBoxConstants.STATES.CACHED);
          const gCachedCount = gCachedLinks.length;
          const isOpen = this.openDrawerGroups.has(gName);

          html += `
            <div class="tb-drawer-group ${isOpen ? 'open' : ''} ${gCachedCount > 0 ? 'has-cached' : ''}" data-group="${gName}">
              <div class="tb-group-header-btn" role="button" tabindex="0">
                <span class="tb-group-title" title="${gName}">🎮 ${gName}</span>
                <div class="tb-group-meta">
                  ${gCachedCount > 0 ? `<span class="tb-group-badge">🟢 ${gCachedCount}</span>` : ''}
                  <span class="tb-group-count">${groupLinks.length}</span>
                  <span class="tb-group-chevron">▼</span>
                </div>
              </div>
              <div class="tb-group-body">
                ${groupLinks.map(l => {
                  const isCached = l.state === window.TorBoxConstants.STATES.CACHED;
                  return `
                    <div class="tb-link-row">
                      <span class="tb-link-name ${isCached ? 'cached' : ''}" title="${l.url}">${l.text || l.url}</span>
                      <div class="tb-link-btns">
                        ${isCached ? `
                          <button class="tb-mini-btn btn-dock-dl" data-url="${l.url}" title="Instant Direct Download">⚡ DL</button>
                        ` : `
                          <button class="tb-mini-btn cloud btn-dock-cloud" data-url="${l.url}" title="Add to TorBox">☁️ To TB</button>
                        `}
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          `;
        });

        html += `</div>`;
        drawer.innerHTML = html;

        const newScrollEl = drawer.querySelector('.tb-drawer-scroll');
        if (newScrollEl) newScrollEl.scrollTop = curScroll;

        // Group accordion toggles
        drawer.querySelectorAll('.tb-group-header-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const groupEl = btn.closest('.tb-drawer-group');
            if (groupEl) {
              const gName = groupEl.dataset.group;
              if (groupEl.classList.contains('open')) {
                groupEl.classList.remove('open');
                if (gName) this.openDrawerGroups.delete(gName);
              } else {
                groupEl.classList.add('open');
                if (gName) this.openDrawerGroups.add(gName);
              }
            }
          });
        });

        drawer.querySelectorAll('.btn-dock-dl').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const u = btn.dataset.url;
            btn.textContent = '⏳';
            btn.disabled = true;
            chrome.runtime.sendMessage({ action: window.TorBoxConstants.MESSAGES.DOWNLOAD_CACHED, url: u }, (res) => {
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
                btn.textContent = '✔️ Started';
                btn.title = 'Download initiated!';
              } else {
                btn.textContent = '⚠️ Failed';
                btn.style.background = '#dc2626';
                btn.title = (res && res.error) ? res.error : 'Download failed';
              }
            });
          });
        });

        drawer.querySelectorAll('.btn-dock-cloud').forEach(btn => {
          btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const u = btn.dataset.url;
            btn.textContent = '⏳';
            btn.disabled = true;
            const isMagnet = u.startsWith('magnet:?');
            const isTorrent = u.toLowerCase().endsWith('.torrent') || u.toLowerCase().includes('.torrent?');
            const isUsenet = u.toLowerCase().endsWith('.nzb') || u.toLowerCase().includes('.nzb?');

            let msg = window.TorBoxConstants.MESSAGES.CREATE_WEBDL;
            if (isMagnet || isTorrent) {
              msg = window.TorBoxConstants.MESSAGES.CREATE_TORRENT;
            } else if (isUsenet) {
              msg = window.TorBoxConstants.MESSAGES.CREATE_USENET;
            }

            chrome.runtime.sendMessage({ action: msg, url: u }, (res) => {
              btn.disabled = false;
              if (res && res.success) {
                btn.textContent = '✔️ Added';
                btn.style.background = '#059669';
                btn.title = res.detail || 'Successfully added to TorBox!';
              } else {
                btn.textContent = '⚠️ Failed';
                btn.style.background = '#dc2626';
                btn.title = (res && res.error) ? res.error : 'Failed to add to TorBox';
              }
            });
          });
        });
      };

      this.floatingDock._renderDrawer = renderDrawer;
      if (drawer && drawer.style.display !== 'none') {
        renderDrawer();
      }
    }
  }

  removeFloatingDock() {
    if (this.floatingDock) {
      this.floatingDock.remove();
      this.floatingDock = null;
      this.floatingDockShadow = null;
    }
  }

  createStreamIndicator() {}
  removeStreamIndicator() {}
}

window.torBoxUI = new TorBoxUI();

