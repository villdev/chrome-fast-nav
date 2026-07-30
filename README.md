# Fast Nav

Fast Nav is a Chrome extension for keyboard-first tab switching on macOS.

It provides two shortcuts:
- `Option+Tab` / `Shift+Option+Tab` for Arc-style most-recently-used tab switching
- `Option+S` for fullscreen toggle

The tab switcher is based on MRU history, not tab strip order. A quick tap toggles between your two most recent tabs. Holding `Option` and tapping `Tab` cycles deeper through your recent tab history, with a floating overlay that shows the current selection. The actual tab switch happens when you release `Option`.

## Features

### MRU tab switching

- `Option+Tab` moves forward through recent tabs
- `Shift+Option+Tab` moves backward
- A single tap toggles between the two most recently used tabs
- Holding `Option` keeps the overlay open so you can cycle deeper before committing
- Releasing `Option` commits the selection
- `Escape` cancels the switcher and keeps you on the current tab

### Fullscreen toggle

- `Option+S` toggles Chrome fullscreen on and off

This is the only browser UI toggle exposed to extensions. Chrome extensions cannot directly hide or control the tab strip/sidebar independently.

## How It Works

Fast Nav keeps an MRU stack of tab ids. Every time a tab becomes active, it moves to the
front of that stack. Background tabs opened together from the current page are inserted
after it in creation order, then follow normal MRU behavior once visited.

For example, opening links `A`, `B`, and `C` in the background produces:

```text
Current -> A -> B -> C -> older tabs
```

After visiting `A`, the order becomes:

```text
A -> previous current -> B -> C -> older tabs
```

Example:

```text
Current MRU stack:
[GitHub] -> [Docs] -> [ChatGPT] -> [YouTube]
```

If you are on `GitHub`:

- Tap `Option+Tab` once: selection moves to `Docs`
- Release `Option`: Chrome switches to `Docs`
- Tap `Option+Tab` again: selection moves back to `GitHub`

If you keep holding `Option`, each additional `Tab` press moves deeper through the same MRU stack before commit.

## Installation

### Local / Developer Mode

1. Open Chrome and go to `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select this folder: `chrome-fast-nav`
5. Reload the extension after local code changes

## Development

Install dependencies with pnpm:

```sh
pnpm install
```

Run the full local check before committing:

```sh
pnpm run check
```

Common commands:

- `pnpm run lint` checks `background.js` and `content.js` with Oxlint.
- `pnpm run format:check` checks formatting with Oxfmt.
- `pnpm run typecheck` runs TypeScript checks against the plain JavaScript files.

To update files automatically:

- `pnpm run lint:fix` applies safe Oxlint fixes.
- `pnpm run format` writes Oxfmt formatting changes.

## Changing Shortcuts

Chrome reserves some browser shortcuts, including `Ctrl+Tab`, so extensions cannot bind them directly.

To change the shortcuts:

1. Open `chrome://extensions/shortcuts`
2. Find `Fast Nav`
3. Assign the keys you want

Good alternatives include `Alt+Q`, `Alt+E`, or other non-reserved combinations.

## Permissions

Fast Nav uses these Chrome permissions:

- `tabs` and `windows` to query and activate tabs
- `storage` to persist the MRU stack
- `scripting` and host access on `<all_urls>` to inject and display the tab switcher overlay

The overlay will not appear on restricted Chrome pages such as `chrome://` pages, the Chrome Web Store, or other pages where extensions are not allowed to inject scripts.

## Project Structure

```text
chrome-fast-nav/
├── manifest.json
├── package.json
├── tsconfig.json
├── background.js
├── content.js
└── icons/
```
