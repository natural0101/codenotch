# Provider marks

The SVG files in this directory come from the npm package `@lobehub/icons-static-svg` 1.95.0
(https://github.com/lobehub/lobe-icons, MIT License) with their original paths and geometry preserved. In these packaged image resources, `currentColor` is resolved to `#e8e8ea`, matching the runtime image renderer:

| File | Original file in the package | Shown in |
|---|---|---|
| claude.svg | icons/claude.svg | Claude cell |
| codex.svg | icons/openai.svg | Codex cell (the OpenAI mark, matching upstream Codenotch's glyph choice) |
| cursor.svg | icons/cursor.svg | Cursor cell |
| gemini.svg | icons/antigravity.svg | Antigravity cell |

MIT License — Copyright (c) LobeHub. See that repository's LICENSE.

**Trademarks**: these marks are trademarks of Anthropic, OpenAI, Anysphere (Cursor) and Google
respectively, and are used here only to identify the product whose usage is displayed. Whether
they stay in a distributed build is the repository owner's call under each brand's guidelines;
they can be swapped for generated glyphs without touching any code.

**Overrides**: a file of the same name (`.svg` or `.png`) in `%APPDATA%\codenotch\glyphs\` takes
precedence over the built-in mark; it is picked up after "Refresh usage now" in the tray menu.
