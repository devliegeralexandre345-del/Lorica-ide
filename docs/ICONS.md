# Regenerating platform icons

Lorica's brand mark lives in `src-tauri/icons/logo.svg` — that's the
single source of truth. Every other icon (taskbar, installer, macOS
`.icns`, Linux desktop entry, system tray) is generated from it.

If you change `logo.svg`, regenerate the raster set before shipping a
release.

## One-command regeneration (recommended)

Tauri ships `cargo tauri icon` which takes **one** high-res PNG and
produces every platform-specific icon Tauri needs. Workflow:

1. **Rasterize the SVG to a 1024×1024 PNG** (one-time step — SVG → PNG).
   Options:
   - Open `src-tauri/icons/logo.svg` in a browser at 1024×1024, screenshot.
   - Or online: upload to https://cloudconvert.com/svg-to-png, pick
     1024×1024, download.
   - Or local: `magick logo.svg -background none -resize 1024x1024 source.png`
     (requires ImageMagick).
   Save the result as `src-tauri/icons/source.png`.

2. **Generate the full set**:
   ```bash
   cd src-tauri
   cargo tauri icon icons/source.png
   ```
   This overwrites `32x32.png`, `128x128.png`, `128x128@2x.png`,
   `icon.png`, `icon.ico`, and on macOS also produces `icon.icns` and
   the `iconset/` directory.

3. **Delete the intermediate** once the overwrite is done:
   ```bash
   rm icons/source.png
   ```
   (Only `logo.svg` and the generated files ship in the repo.)

4. **Verify visually** — open each generated file in a viewer. Pay
   attention to the 32×32 which is what shows in the Windows taskbar;
   designs with thin features (like Lorica's 5-bar) can alias ugly at
   that size. Thicken bars in the SVG if needed and regenerate.

5. **Commit** both `logo.svg` and all regenerated raster files together.

## Manual workflow (if `cargo tauri icon` isn't available)

Install ImageMagick (Windows: `winget install ImageMagick.ImageMagick`,
macOS: `brew install imagemagick`, Debian/Ubuntu: `sudo apt install
imagemagick`), then from `src-tauri/icons/`:

```bash
magick logo.svg -background none -resize 32x32   32x32.png
magick logo.svg -background none -resize 128x128 128x128.png
magick logo.svg -background none -resize 256x256 128x128@2x.png
magick logo.svg -background none -resize 512x512 icon.png
magick logo.svg -background none -define icon:auto-resize=16,24,32,48,64,128,256 icon.ico
```

For macOS `.icns` (only if you ship a Mac build):

```bash
mkdir icon.iconset
magick logo.svg -background none -resize 16x16    icon.iconset/icon_16x16.png
magick logo.svg -background none -resize 32x32    icon.iconset/icon_16x16@2x.png
magick logo.svg -background none -resize 32x32    icon.iconset/icon_32x32.png
magick logo.svg -background none -resize 64x64    icon.iconset/icon_32x32@2x.png
magick logo.svg -background none -resize 128x128  icon.iconset/icon_128x128.png
magick logo.svg -background none -resize 256x256  icon.iconset/icon_128x128@2x.png
magick logo.svg -background none -resize 256x256  icon.iconset/icon_256x256.png
magick logo.svg -background none -resize 512x512  icon.iconset/icon_256x256@2x.png
magick logo.svg -background none -resize 512x512  icon.iconset/icon_512x512.png
magick logo.svg -background none -resize 1024x1024 icon.iconset/icon_512x512@2x.png
iconutil -c icns icon.iconset -o icon.icns
rm -rf icon.iconset
```

## Design notes

The current logo is a 5-bar diminishing stack in the theme's accent
colour. Tradeoffs:

- ✅ Scales down well to 32×32 (bars remain readable).
- ✅ Theme-agnostic: the SVG embeds the accent colour directly for
  raster, but the React `LoricaLogo.jsx` component binds to `--color-accent`
  for in-app rendering.
- ⚠ Very thin at 16×16 — Windows jump-list might crop it badly. If that
  becomes a complaint, fatten the bars (height 14 → 18 in the SVG).
- ⚠ The dark squircle background (`<rect fill="#0a0a0f">`) reads well on
  taskbars but may clash if your OS taskbar is light. Remove it in
  `logo.svg` if users on light themes complain; the naked bars work too.

If you want a radically different logo, edit `logo.svg` AND the inline
JSX in `src/components/LoricaLogo.jsx` so the in-app mark and the OS
icon stay in sync.
