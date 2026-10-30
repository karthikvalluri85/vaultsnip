# Media

The demo recording shown in the main README. None of these files is part of the web app or the extension.

| File | What it is |
|---|---|
| `vaultsnip-demo.mp4` | Full-speed screen recording of VaultSnip 0.9.0 at vaultsnip.pages.dev, H.264, 1280 × 864, no audio |
| `vaultsnip-demo.webp` | The same recording sped up 2.5×, animated WebP, for the README |
| `vaultsnip-demo-poster.jpg` | A still from the recording |

Only the bundled, fictional sample dashboard appears in it: no real company, person or figure. Keep it that way for
any new recording.

To remake the files from a new screen recording `in.mp4` (crop to the app, then encode):

```bash
ffmpeg -i in.mp4 -an -vf "crop=W:H:X:Y,scale=1280:-2" -c:v libx264 -preset veryfast -crf 26 -pix_fmt yuv420p -movflags +faststart vaultsnip-demo.mp4
ffmpeg -i vaultsnip-demo.mp4 -vf "setpts=PTS/2.5,fps=6,scale=720:-2" -loop 0 -c:v libwebp -quality 45 -compression_level 6 vaultsnip-demo.webp
ffmpeg -ss 26 -i vaultsnip-demo.mp4 -frames:v 1 -q:v 3 vaultsnip-demo-poster.jpg
```
