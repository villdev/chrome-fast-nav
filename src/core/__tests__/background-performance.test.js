import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function createChromeEvent() {
  let listener = null;

  return {
    addListener: vi.fn((nextListener) => {
      listener = nextListener;
    }),
    dispatch(...args) {
      return listener?.(...args);
    },
  };
}

function createChromeMock() {
  const tabs = [
    {
      id: 1,
      windowId: 10,
      active: true,
      title: 'Current',
      url: 'https://example.com/current',
    },
    {
      id: 2,
      windowId: 10,
      active: false,
      title: 'Previous',
      url: 'https://example.com/previous',
    },
    {
      id: 3,
      windowId: 10,
      active: false,
      title: 'Older',
      url: 'https://example.com/older',
    },
  ];

  return {
    commands: {
      onCommand: createChromeEvent(),
    },
    runtime: {
      onInstalled: createChromeEvent(),
      onMessage: createChromeEvent(),
      onStartup: createChromeEvent(),
    },
    scripting: {
      executeScript: vi.fn(async () => []),
    },
    storage: {
      session: {
        get: vi.fn(async () => ({ mruStack: [1, 2, 3] })),
        set: vi.fn(async () => {}),
      },
    },
    tabs: {
      onActivated: createChromeEvent(),
      onCreated: createChromeEvent(),
      onRemoved: createChromeEvent(),
      query: vi.fn(async () => tabs),
      sendMessage: vi.fn(async () => {}),
      update: vi.fn(async () => {}),
    },
    windows: {
      get: vi.fn(async () => ({ id: 10, state: 'normal' })),
      getLastFocused: vi.fn(async () => ({ id: 10 })),
      update: vi.fn(async () => {}),
    },
  };
}

describe('background navigation performance', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete globalThis.chrome;
  });

  it('keeps warm MRU updates and repeated navigation within the Chrome API call budget', async () => {
    const chromeMock = createChromeMock();
    globalThis.chrome = chromeMock;
    await import('../../background.js');

    chromeMock.tabs.onActivated.dispatch({ tabId: 2, windowId: 10 });
    await vi.waitFor(() => expect(chromeMock.storage.session.set).toHaveBeenCalledTimes(1));
    chromeMock.tabs.onActivated.dispatch({ tabId: 3, windowId: 10 });
    await vi.waitFor(() => expect(chromeMock.storage.session.set).toHaveBeenCalledTimes(2));

    expect(chromeMock.storage.session.get).toHaveBeenCalledTimes(1);

    chromeMock.commands.onCommand.dispatch('mru-next', { id: 1, windowId: 10 });
    await vi.waitFor(() => expect(chromeMock.tabs.sendMessage).toHaveBeenCalledTimes(1));

    expect(chromeMock.tabs.query).toHaveBeenCalledTimes(1);
    expect(chromeMock.storage.session.get).toHaveBeenCalledTimes(1);
    expect(chromeMock.tabs.sendMessage).toHaveBeenLastCalledWith(
      1,
      expect.objectContaining({
        action: 'showSwitcher',
        selectedIndex: 1,
        tabs: expect.any(Array),
      }),
    );

    chromeMock.commands.onCommand.dispatch('mru-next', { id: 1, windowId: 10 });
    await vi.waitFor(() => expect(chromeMock.tabs.sendMessage).toHaveBeenCalledTimes(2));

    expect(chromeMock.tabs.query).toHaveBeenCalledTimes(1);
    expect(chromeMock.storage.session.get).toHaveBeenCalledTimes(1);
    expect(chromeMock.tabs.sendMessage).toHaveBeenLastCalledWith(1, {
      action: 'updateSwitcherSelection',
      sessionId: 1,
      selectedIndex: 2,
    });

    await chromeMock.tabs.onRemoved.dispatch(3);

    expect(chromeMock.tabs.query).toHaveBeenCalledTimes(1);
    expect(chromeMock.tabs.sendMessage).toHaveBeenLastCalledWith(
      1,
      expect.objectContaining({
        action: 'showSwitcher',
        selectedIndex: 1,
        tabs: [expect.objectContaining({ id: 1 }), expect.objectContaining({ id: 2 })],
      }),
    );
  });
});
