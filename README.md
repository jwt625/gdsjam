<div align="center">
  <a href="https://gdsjam.com"><img src="public/icon.svg" alt="GDSJam Icon" width="128" height="128"></a>

  # GDSJam

  Web-based GDSII viewer for semiconductor layout visualization.

  [https://gdsjam.com](https://gdsjam.com)

  [![CI](https://github.com/jwt625/gdsjam/actions/workflows/ci.yml/badge.svg)](https://github.com/jwt625/gdsjam/actions/workflows/ci.yml)
  [![Deploy](https://github.com/jwt625/gdsjam/actions/workflows/deploy.yml/badge.svg)](https://github.com/jwt625/gdsjam/actions/workflows/deploy.yml)
  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
  [![Svelte](https://img.shields.io/badge/Svelte-5-orange.svg)](https://svelte.dev/)
</div>

## Overview

GDSJam is a GDSII and DXF file viewer available as both a web application and desktop app. Built for academics, chip design newcomers, and the photonics community to promote open-source EDA culture.

**Web Version:** Client-side processing in the browser - your files never leave your device.

**Desktop App:** Native application with file watching and auto-reload capabilities for local development workflows.


## Screenshots

<div align="center">
  <img src="public/example.png" alt="GDSJam Desktop View" height="400">
  <img src="public/example_mobile.png" alt="GDSJam Mobile View" height="400">
  <br>
  <sub>Desktop view (left) and mobile view (right)</sub>
</div>

## Features

- **GDSII/DXF viewing** with WebGL acceleration
- **LOD rendering** with polygon budgeting for large files
- **Layer visibility controls** with sync option
- **P2P collaboration** via WebRTC + Y.js (shareable sessions, host/viewer model, viewport sync)
- **Interactive minimap** showing all participants' viewports
- **Mobile-friendly** with touch controls
- **Desktop app** with file watching and auto-reload (macOS, Windows, Linux)

## Technology Stack

- **Frontend**: Svelte 5 + TypeScript + Vite
- **Rendering**: [Pixi.js](https://pixijs.com/) v8 (WebGL2)
- **GDSII Parsing**: [gdsii](https://github.com/TinyTapeout/gdsii) by TinyTapeout
- **Spatial Indexing**: [rbush](https://github.com/mourner/rbush) (R-tree for viewport culling)
- **Desktop**: [Tauri](https://tauri.app/) v2 (Rust + system WebView)
- **Styling**: Tailwind CSS v4
- **Tooling**: Biome, Vitest, Husky

## Development

### Web Version

```bash
# Install dependencies
pnpm install

# Start dev server
pnpm dev

# Run type checking
pnpm check

# Run linter
pnpm lint

# Run tests
pnpm test
```

### Desktop App

**Prerequisites:**
- [Rust](https://www.rust-lang.org/tools/install) (for Tauri backend)
- All web dependencies (pnpm install)

```bash
# Run desktop app in development mode (with hot reload)
pnpm tauri:dev

# Build production desktop app
pnpm tauri:build
```

**Desktop Features:**
- Native file picker with GDS/DXF filters
- File watching with auto-reload (500ms debounce)
- Path persistence across app restarts
- All web features included

See [src-tauri/README.md](src-tauri/README.md) for detailed desktop app documentation.

## Architecture

- **Coordinate System**: Database units with Y-up Cartesian convention (typically µm, but depends on file)
- **Rendering**: LOD with polygon budgeting, R-tree spatial indexing for viewport culling
- **Collaboration**: Y.js CRDT with WebRTC, host as ground truth (localStorage), viewers sync via signaling server

## Acknowledgments

This project uses the following open-source libraries:

- **[gdsii](https://github.com/TinyTapeout/gdsii)** - GDSII parser by TinyTapeout (MIT/Apache-2.0)
- **[Pixi.js](https://pixijs.com/)** - WebGL rendering engine (MIT)
- **[rbush](https://github.com/mourner/rbush)** - High-performance R-tree spatial index by Vladimir Agafonkin (MIT)
- **[Svelte](https://svelte.dev/)** - Reactive UI framework (MIT)

## Privacy

**Without collaboration sessions:** This webapp is entirely client-side — all file processing happens in your browser and your files never leave your device.

**With collaboration sessions:** When you host or join a session:
- **Files you upload** are temporarily stored on our server for sharing with session participants
- Files are stored as content-addressed blobs (SHA-256 hash) and **automatically deleted after 7 days**
- We log **IP addresses** for rate limiting (max 10 uploads/hour) and security purposes
- **No user accounts** are created — we don't track personal information beyond what's technically necessary
- Session metadata (file name, size, uploader ID) is synchronized via WebRTC to session participants

**Recommendation:** Do not upload files containing sensitive or proprietary designs if you're not comfortable with temporary server-side storage.


## License

MIT

## Author

Created by [Wentao](https://outside5sigma.com/) and Claude.
