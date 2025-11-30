# GDSJam Desktop App

Native desktop application for GDSJam built with Tauri v2.

## Overview

The desktop app provides enhanced file system integration while maintaining all web features. It uses Tauri to wrap the web frontend in a native window with Rust-powered file operations.

## Architecture

- **Frontend**: Same Svelte/TypeScript codebase as web version
- **Backend**: Rust with Tauri framework
- **WebView**: System WebView (Safari on macOS, Edge on Windows, WebKitGTK on Linux)
- **Bundle Size**: ~3-5 MB (vs 50-100 MB for Electron)

## Dependencies

### Rust Dependencies

Defined in `Cargo.toml`:

- `tauri` 2.9.4 - Core framework
- `tauri-plugin-dialog` 2 - Native file picker
- `tauri-plugin-fs` 2 - File system access
- `tauri-plugin-log` 2 - Logging
- `notify` 6.1 - File system watching
- `notify-debouncer-full` 0.3 - Debounced file events
- `serde` 1.0 - Serialization
- `serde_json` 1.0 - JSON handling

### Frontend Dependencies

Defined in root `package.json`:

- `@tauri-apps/api` - JavaScript bindings for Tauri
- `@tauri-apps/plugin-dialog` - Dialog plugin bindings
- `@tauri-apps/plugin-fs` - File system plugin bindings
- `@tauri-apps/cli` - Tauri CLI (dev dependency)

## Development Workflow

### Prerequisites

1. **Rust**: Install from https://www.rust-lang.org/tools/install
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

2. **System Dependencies** (platform-specific):
   - **macOS**: Xcode Command Line Tools
   - **Linux**: `webkit2gtk`, `libssl-dev`, `libgtk-3-dev`, etc.
   - **Windows**: Microsoft C++ Build Tools

3. **Frontend Dependencies**:
   ```bash
   pnpm install
   ```

### Development Commands

```bash
# Run desktop app in dev mode (hot reload enabled)
pnpm tauri:dev

# Build Rust backend only
cd src-tauri && cargo build

# Build production app bundle
pnpm tauri:build

# Run Rust tests
cd src-tauri && cargo test

# Check Rust code
cd src-tauri && cargo check
```

### Development Mode

When running `pnpm tauri:dev`:
1. Vite dev server starts on http://localhost:5173/
2. Rust backend compiles and runs
3. Desktop window opens displaying the Vite dev server
4. Hot reload works for both frontend and backend changes

### File Watching

The Rust backend watches files using the `notify` crate with 500ms debouncing to prevent excessive reloads during rapid file changes (e.g., text editor auto-saves).

## Tauri Commands

Rust functions exposed to frontend via `#[tauri::command]`:

### `open_file_dialog() -> Result<Option<String>, String>`
Opens native file picker with GDS/DXF filters. Returns selected file path.

### `watch_file(path: String) -> Result<(), String>`
Starts watching a file for changes. Emits `file-changed` event to frontend when file is modified.

### `unwatch_file() -> Result<(), String>`
Stops watching the current file.

### `get_last_file_path() -> Result<Option<String>, String>`
Retrieves the last opened file path from app data directory.

### `save_last_file_path(path: String) -> Result<(), String>`
Persists file path to app data directory for restoration on next launch.

## Configuration

### `tauri.conf.json`

Key settings:
- `identifier`: `com.gdsjam.app`
- `frontendDist`: `../dist` (Vite build output)
- `devUrl`: `http://localhost:5173` (Vite dev server)
- Window size: 1400x900 (min 800x600)
- Icons: PNG files in `icons/` directory

### Permissions

Defined in `capabilities/default.json`:
- `dialog:allow-open` - File picker
- `fs:allow-read-file` - Read files
- `fs:allow-write-file` - Write files
- `fs:allow-exists` - Check file existence
- `fs:allow-create` - Create files
- `fs:allow-mkdir` - Create directories

## Building for Production

```bash
pnpm tauri:build
```

Output locations:
- **macOS**: `src-tauri/target/release/bundle/dmg/`
- **Windows**: `src-tauri/target/release/bundle/msi/`
- **Linux**: `src-tauri/target/release/bundle/deb/` or `appimage/`

## Hybrid Deployment

The app supports both web and desktop modes from the same codebase:

- **Feature Detection**: `isTauri()` checks for `window.__TAURI__`
- **Conditional UI**: Desktop-only controls render only in Tauri environment
- **Graceful Degradation**: All Tauri functions return safely in web mode

## Troubleshooting

### Build Errors

**"Rust not found"**: Install Rust toolchain
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

**"webkit2gtk not found" (Linux)**: Install system dependencies
```bash
sudo apt install libwebkit2gtk-4.1-dev libssl-dev libgtk-3-dev
```

### Runtime Issues

**File watcher not working**: Check file permissions and ensure path is absolute.

**App won't start**: Check console output for Rust panics or frontend errors.

## References

- [Tauri Documentation](https://tauri.app/)
- [Tauri API Reference](https://tauri.app/v2/reference/javascript/api/)
- [notify crate](https://docs.rs/notify/)

