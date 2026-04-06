if (!window.__fastNavInitialized) {
  window.__fastNavInitialized = true;

  let overlay = null;
  let listEl = null;
  let selectedIndex = 0;

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
    document.documentElement.appendChild(overlay);

    document.addEventListener('keydown', onKeyDown, true);
    syncSelection(nextSelectedIndex);
  }

  function destroyOverlay() {
    if (!overlay) return;

    document.removeEventListener('keydown', onKeyDown, true);
    overlay.remove();
    overlay = null;
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
