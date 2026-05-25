# Julion — Required Image Assets

Place the following files in this directory. All should use your Julion logo as the source.

## Favicon set (generate at https://realfavicongenerator.net)

| File                         | Size       | Use                           |
|------------------------------|------------|-------------------------------|
| `favicon.ico`                | 16+32+48px | Browser tab (legacy + modern) |
| `favicon-16x16.png`          | 16×16      | Browser tab                   |
| `favicon-32x32.png`          | 32×32      | Browser tab retina            |
| `apple-touch-icon.png`       | 180×180    | iOS home screen               |
| `android-chrome-192x192.png` | 192×192    | Android home screen           |
| `android-chrome-512x512.png` | 512×512    | PWA splash + maskable icon    |
| `ms-icon-70x70.png`          | 70×70      | Windows tile small            |
| `ms-icon-144x144.png`        | 144×144    | Windows tile medium (IE11)    |
| `ms-icon-150x150.png`        | 150×150    | Windows tile medium           |
| `ms-icon-310x310.png`        | 310×310    | Windows tile large            |

## Social / OG images

| File              | Size      | Use                                          |
|-------------------|-----------|----------------------------------------------|
| `julion-og.png`   | 1200×630  | Open Graph (Facebook, LinkedIn, Slack, etc.) |
| `julion-logo.png` | 512×512   | Structured data logo, navbar brand image     |

## Quick generation steps

1. Go to https://realfavicongenerator.net
2. Upload your logo PNG (minimum 512×512)
3. Download the favicon package and extract all files here
4. Rename the generated `site.webmanifest` entries to match the paths above

## OG image tips

- Background: #090b11 (matches site dark theme)
- Logo: centered, white or light version
- Tagline: "Snapshot, Store & Restore Your Projects"
- Dimensions: exactly 1200×630 px
- Tools: Figma, Canva, or https://og-playground.vercel.app
