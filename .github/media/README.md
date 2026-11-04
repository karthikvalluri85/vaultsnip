# Media

The demo shown in the main README. None of these files is part of the web app or the extension.

| File | What it is |
|---|---|
| `vaultsnip-demo.gif` | Seven-step walkthrough of VaultSnip 0.14 with step captions: paste the sample, the quick mask in seconds, the background checks, copy, blur every chart shape, the replica. Animated GIF, 960 × 540, about 41 s |

Only the bundled, fictional sample dashboard appears in it: no real company, person or figure. Keep it that way for
any new recording.

The recording is made headless with Playwright against `web/` (viewport 1280 × 720, captions injected as a fixed bar, Chrome's own video recording), then the waits are trimmed and the clip encoded with a shared palette. To remake the GIF from a new screen recording `in.mp4` (crop to the app, then encode with a shared palette):

```bash
ffmpeg -i in.mp4 -vf "crop=W:H:X:Y,fps=6,scale=960:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4" -loop 0 vaultsnip-demo.gif
```
