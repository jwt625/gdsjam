<div align="center">
  <img src="public/icon.svg" alt="GDSJam Icon" width="128" height="128">

  # GDSJam

  Web-based GDSII viewer for semiconductor layout visualization.

  [https://gdsjam.com](https://gdsjam.com)
</div>

## Overview

GDSJam is a client-side web application for viewing GDSII files directly in the browser. Built for academics, chip design newcomers, and the photonics community to promote open-source EDA culture.

**Privacy**: All processing happens in your browser - your GDS files are never uploaded to any server.

## Screenshots

<div align="center">
  <img src="public/example.png" alt="GDSJam Desktop View" height="400">
  <img src="public/example_mobile.png" alt="GDSJam Mobile View" height="400">
  <br>
  <sub>Desktop view (left) and mobile view (right)</sub>
</div>

## Features

- Client-side GDSII file rendering with WebGL acceleration
- Interactive zoom, pan, and navigation controls
- Layer visibility controls with color customization
- Cell hierarchy navigation
- Performance optimized for large files (LOD rendering, viewport culling)
- Dark mode interface
- Mobile-friendly touch controls

## Technology Stack

- **Frontend**: Svelte 5 + TypeScript + Vite
- **Rendering**: [Pixi.js](https://pixijs.com/) v8 (WebGL2)
- **GDSII Parsing**: [gdsii](https://github.com/TinyTapeout/gdsii) by TinyTapeout
- **Spatial Indexing**: [rbush](https://github.com/mourner/rbush) (R-tree for viewport culling)
- **Styling**: Tailwind CSS v4
- **Tooling**: Biome, Vitest, Husky

## Development

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

## Architecture

- **Coordinate System**: Micrometers (µm)
- **Rendering Strategy**: Level-of-Detail (LOD) rendering with viewport culling
- **Spatial Indexing**: R-tree for efficient visibility queries
- **Performance**: Optimized for large files with polygon budgeting and incremental rendering

## Acknowledgments

This project uses the following open-source libraries:

- **[gdsii](https://github.com/TinyTapeout/gdsii)** - GDSII parser by TinyTapeout (MIT/Apache-2.0)
- **[Pixi.js](https://pixijs.com/)** - WebGL rendering engine (MIT)
- **[rbush](https://github.com/mourner/rbush)** - High-performance R-tree spatial index by Vladimir Agafonkin (MIT)
- **[Svelte](https://svelte.dev/)** - Reactive UI framework (MIT)

## Documentation

See `DevLog/` directory for detailed planning and implementation notes.

## License

MIT

## Author

Created by [Wentao](https://outside5sigma.com/) and Claude.
