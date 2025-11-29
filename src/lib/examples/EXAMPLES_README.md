# Example GDS Files - Attribution & Licenses

This document provides attribution and license information for the example GDS files used in gdsjam.

## Sources

### gdsfactory

**Repository**: https://github.com/gdsfactory/gdsfactory
**License**: MIT
**Description**: GDSFactory is a Python library for designing photonic chips.

#### Files Used:
- `mzi2x2.gds` - Mach-Zehnder Interferometer 2x2

```
MIT License

Copyright (c) 2019-2024 gdsfactory contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
```

---

### UBC PDK (via gdsfactory)

**Repository**: https://github.com/gdsfactory/ubc
**License**: MIT
**Description**: UBC SiEPIC EBeam PDK for silicon photonics, maintained by gdsfactory.

#### Files Used:
- `ebeam_gc_te1550.gds` - Grating Coupler TE 1550nm
- `ebeam_y_1550.gds` - Y-Branch Splitter 1550nm

```
MIT License

Copyright (c) 2019-2024 gdsfactory contributors
```

---

### TinyTapeout

**Repository**: https://github.com/TinyTapeout/tinytapeout-02
**License**: Apache-2.0
**Description**: TinyTapeout is an educational project that makes it easier to get a chip manufactured.

#### Files Used:
- `gatecat_fpga_top.gds.gz` - FPGA implementation by gatecat
- `gregdavill_serv_top.gds.gz` - RISC-V SERV core by gregdavill
- `gregdavill_clock_top.gds.gz` - Digital clock by gregdavill
- `cpldcpu_MCPU5plus.gds.gz` - MCPU5+ processor by cpldcpu

```
Apache License 2.0

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
```

---

### jwt625/gdsii Dataset

**Repository**: https://huggingface.co/datasets/jwt625/gdsii
**License**: MIT
**Description**: Collection of GDSII files for gdsjam examples.

#### Files Used:
- `NTNAR04B_100nm_20210714.gds` - Photomask layout example

---

## Hosting

Example files are loaded from their original GitHub repositories or from the Hugging Face dataset at:
https://huggingface.co/datasets/jwt625/gdsii

Hugging Face is preferred for hosting due to:
- Better CORS support for browser-based loading
- CDN-like performance
- Git LFS support for larger files
- Easy independent updates

---

## Adding New Examples

To add a new example:

1. Ensure the file is under a permissive license (MIT, Apache-2.0, BSD, etc.)
2. Add proper attribution in this file
3. Upload to the HuggingFace dataset or use the original source URL
4. Add entry to `examples.ts` with all required metadata

### File Size Guidelines

- **Recommended**: < 5 MB uncompressed
- **Maximum**: < 50 MB uncompressed (renderer may struggle with larger files)
- Use gzip compression for files > 1 MB

### Preview Images

Pre-generated preview images should be:
- Overview: 400x300 PNG
- Detail: 200x150 PNG (optional)
- Stored alongside GDS files or embedded as base64 for small thumbnails

