# Speed Dial 2

A local-first Chrome new-tab speed dial extension built with Manifest V3.

This is an independent community implementation. It is not affiliated with or endorsed by the original Speed Dial 2 service.

## Features

- Website and group management
- Drag-and-drop sorting and cross-group moving
- Local search and visit statistics
- Automatic, uploaded and URL-based thumbnails
- Chrome bookmarks, history, recently closed tabs and Top Sites integration
- Customizable layout, appearance, background and sidebars
- JSON backup and restore
- Export to Chrome bookmarks
- Local storage with IndexedDB and `chrome.storage.local`

Account, cloud sync, payment, advertising, recommendations, analytics, telemetry and remote executable code are not included.

## Installation

1. Download and extract the packaged ZIP from the latest GitHub Actions artifact or clone this repository.
2. Open `chrome://extensions/` in Chrome.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose the extracted extension directory containing `manifest.json` (the repository's `extension/` directory).

## Development

No build step or third-party runtime dependency is required.

Run the validation checks with:

```bash
node scripts/validate.mjs
```

The extension requests Chrome bookmarks, history, sessions, Top Sites, tabs and website access for its local browser-integration features and user-requested webpage screenshots. Extension data remains in the active Chrome profile unless exported by the user.

## Packaging

The GitHub Actions workflow validates the source and creates `speed-dial-2.zip`. The archive contains `manifest.json` at its root and can be extracted and loaded directly through Chrome's **Load unpacked** flow.

## License

Licensed under the [MIT License](LICENSE).
