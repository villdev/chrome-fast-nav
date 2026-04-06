if (!window.__fastNavInitialized) {
  window.__fastNavInitialized = true;

  let overlay = null;
  let overlayHost = null;
  let overlayRoot = null;
  let listEl = null;
  let selectedIndex = 0;

  const overlayStyles = `
    :host {
      all: initial;
    }

    #fast-nav-switcher {
      position: fixed !important;
      inset: 0 !important;
      z-index: 2147483647 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      pointer-events: none !important;
      margin: 0 !important;
      padding: 0 !important;
      box-sizing: border-box !important;
      transform: none !important;
    }

    #fast-nav-switcher::before {
      content: "";
      position: absolute;
      inset: 0;
      background:
        radial-gradient(circle at top, rgba(92, 112, 255, 0.12), transparent 42%),
        rgba(9, 11, 18, 0.2);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
    }

    .fast-nav-card {
      position: relative;
      width: min(520px, calc(100vw - 32px));
      max-width: calc(100vw - 32px);
      max-height: min(72vh, 560px);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 18px;
      background:
        linear-gradient(180deg, rgba(39, 43, 58, 0.96), rgba(20, 22, 30, 0.96));
      box-shadow:
        0 22px 50px rgba(0, 0, 0, 0.45),
        0 4px 18px rgba(0, 0, 0, 0.2);
      color: #f5f7fb;
      pointer-events: auto;
      animation: fast-nav-enter 120ms cubic-bezier(0.22, 1, 0.36, 1);
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
      box-sizing: border-box;
    }

    @keyframes fast-nav-enter {
      from {
        opacity: 0;
        transform: translateY(10px) scale(0.97);
      }

      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    .fast-nav-header {
      padding: 14px 18px 10px;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: rgba(245, 247, 251, 0.56);
    }

    .fast-nav-list {
      margin: 0;
      padding: 0 10px 10px;
      list-style: none;
      overflow: auto;
    }

    .fast-nav-list::-webkit-scrollbar {
      width: 6px;
    }

    .fast-nav-list::-webkit-scrollbar-thumb {
      background: rgba(255, 255, 255, 0.14);
      border-radius: 999px;
    }

    .fast-nav-item {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 0;
      padding: 11px 12px;
      border-radius: 12px;
      transition: background 90ms ease, transform 90ms ease;
    }

    .fast-nav-selected {
      background: linear-gradient(180deg, rgba(100, 140, 255, 0.34), rgba(67, 106, 222, 0.24));
      box-shadow: inset 0 0 0 1px rgba(169, 193, 255, 0.26);
    }

    .fast-nav-icon-wrap {
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.06);
      flex: 0 0 auto;
    }

    .fast-nav-favicon {
      width: 16px;
      height: 16px;
      object-fit: contain;
    }

    .fast-nav-text {
      min-width: 0;
      display: flex;
      flex: 1;
      flex-direction: column;
    }

    .fast-nav-label {
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      font-size: 14px;
      line-height: 1.35;
      font-weight: 560;
      color: #f5f7fb;
    }

    .fast-nav-url {
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      margin-top: 2px;
      font-size: 11px;
      line-height: 1.3;
      color: rgba(245, 247, 251, 0.56);
    }

    .fast-nav-hint {
      padding: 12px 18px 14px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      font-size: 11px;
      color: rgba(245, 247, 251, 0.62);
    }
  `;

  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Alt' && !event.repeat) {
        chrome.runtime.sendMessage({
          action: 'modifierChange',
          key: 'Alt',
          isDown: true,
        }).catch(() => {});
      }
    },
    true
  );

  document.addEventListener(
    'keyup',
    (event) => {
      if (event.key === 'Alt') {
        chrome.runtime.sendMessage({
          action: 'modifierChange',
          key: 'Alt',
          isDown: false,
        }).catch(() => {});
      }
    },
    true
  );

  function getHostname(url) {
    try {
      return new URL(url).hostname;
    } catch (_) {
      return url || '';
    }
  }

  function buildOverlay(tabs, nextSelectedIndex) {
    destroyOverlay();
    selectedIndex = nextSelectedIndex;

    overlayHost = document.createElement('div');
    overlayHost.id = 'fast-nav-switcher-host';
    overlayHost.style.all = 'initial';
    overlayHost.style.position = 'fixed';
    overlayHost.style.inset = '0';
    overlayHost.style.zIndex = '2147483647';
    overlayHost.style.pointerEvents = 'none';

    overlayRoot = overlayHost.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = overlayStyles;
    overlayRoot.appendChild(style);

    overlay = document.createElement('div');
    overlay.id = 'fast-nav-switcher';

    const card = document.createElement('div');
    card.className = 'fast-nav-card';

    const header = document.createElement('div');
    header.className = 'fast-nav-header';
    header.textContent = 'Recent tabs';

    listEl = document.createElement('ul');
    listEl.className = 'fast-nav-list';

    tabs.forEach((tab, index) => {
      const item = document.createElement('li');
      item.className = 'fast-nav-item';
      if (index === selectedIndex) {
        item.classList.add('fast-nav-selected');
      }

      const iconWrap = document.createElement('div');
      iconWrap.className = 'fast-nav-icon-wrap';

      const icon = document.createElement('img');
      icon.className = 'fast-nav-favicon';
      icon.src = tab.favIconUrl || '';
      icon.alt = '';
      icon.onerror = () => {
        icon.style.visibility = 'hidden';
      };

      const text = document.createElement('div');
      text.className = 'fast-nav-text';

      const title = document.createElement('span');
      title.className = 'fast-nav-label';
      title.textContent = tab.title || tab.url || 'Untitled';

      const meta = document.createElement('span');
      meta.className = 'fast-nav-url';
      meta.textContent = index === 0 ? 'Current tab' : getHostname(tab.url);

      text.appendChild(title);
      text.appendChild(meta);
      iconWrap.appendChild(icon);
      item.appendChild(iconWrap);
      item.appendChild(text);

      item.addEventListener('mousedown', (event) => {
        event.preventDefault();
        chrome.runtime
          .sendMessage({ action: 'switchToTab', tabId: tab.id })
          .catch(() => {});
      });

      listEl.appendChild(item);
    });

    const hint = document.createElement('div');
    hint.className = 'fast-nav-hint';
    hint.textContent = 'Hold Option and tap Tab to move. Release Option to commit.';

    card.appendChild(header);
    card.appendChild(listEl);
    card.appendChild(hint);
    overlay.appendChild(card);
    overlayRoot.appendChild(overlay);
    (document.body || document.documentElement).appendChild(overlayHost);

    document.addEventListener('keydown', onKeyDown, true);
    syncSelection(nextSelectedIndex);
  }

  function destroyOverlay() {
    if (!overlay) return;

    document.removeEventListener('keydown', onKeyDown, true);
    overlayHost?.remove();
    overlay = null;
    overlayHost = null;
    overlayRoot = null;
    listEl = null;
    selectedIndex = 0;
  }

  function syncSelection(nextSelectedIndex) {
    if (!listEl) return;

    const items = listEl.querySelectorAll('.fast-nav-item');
    items.forEach((item, index) => {
      item.classList.toggle('fast-nav-selected', index === nextSelectedIndex);
    });

    selectedIndex = nextSelectedIndex;
    items[selectedIndex]?.scrollIntoView({ block: 'nearest' });
  }

  function onKeyDown(event) {
    if (!overlay) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      chrome.runtime.sendMessage({ action: 'cancelNav' }).catch(() => {});
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      chrome.runtime.sendMessage({ action: 'commitNav' }).catch(() => {});
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'showSwitcher') {
      const tabs = Array.isArray(msg.tabs) ? msg.tabs : [];
      const nextSelectedIndex = Number.isInteger(msg.selectedIndex) ? msg.selectedIndex : 0;

      if (!overlay) {
        buildOverlay(tabs, nextSelectedIndex);
      } else {
        syncSelection(nextSelectedIndex);
      }
    } else if (msg.action === 'closeSwitcher') {
      destroyOverlay();
    }
  });
}
