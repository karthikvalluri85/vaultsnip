# Media

The demo shown in the main README. None of these files is part of the web app or the extension.

| File | What it is |
|---|---|
| `vaultsnip-demo.gif` | Six-step walkthrough of VaultSnip 0.13.0 at vaultsnip.pages.dev with step captions, animated GIF, 960 × 540, about 22 s |

Only the bundled, fictional sample dashboard appears in it: no real company, person or figure. Keep it that way for
any new recording.

To remake the GIF from a new screen recording `in.mp4` (crop to the app, then encode with a shared palette):

```bash
ffmpeg -i in.mp4 -vf "crop=W:H:X:Y,fps=7,scale=960:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4" -loop 0 vaultsnip-demo.gif
```
