# Vision model evaluation (developer tool)

Can a small open vision model recover a dashboard's layout from a **masked** screenshot, on the device, without an AI
key? This script runs candidate models on the same image and prompt and scores each answer against the true layout.
Nothing here ships in VaultSnip.

```sh
node tools/eval-vision/eval.mjs                                   # default models, bundled sample
node tools/eval-vision/eval.mjs my-masked.png --truth my.json     # your own image and ground truth
node tools/eval-vision/eval.mjs --models qwen3-vl-2b,florence2-large
```

- `masked-dashboard.png`: VaultSnip's first sample dashboard after its own on-device masking (fictional data).
- `truth.json`: that dashboard's visuals, titles, labels and hand-measured boxes (0–1000 scale).
- Results: raw answers and `scores.json` in `results/` (or `--out`).

**Models** (all MIT or Apache-2.0, ONNX weights on the Hugging Face Hub, supported by Transformers.js 4.3):
`smolvlm-256m`, `smolvlm-500m`, `florence2-base`, `florence2-large`, `moondream2`, `qwen3-vl-2b`, `qwen2-vl-2b`.
Qwen2.5-VL-3B is not included: its licence (qwen-research) does not allow redistribution in VaultSnip.

**Scores**
- `json`: the answer parses as the requested JSON.
- `visuals`, `typeAccuracy`: visuals found; share of the true visuals matched by one of the same chart type.
- `titleRecall`, `labelRecall`: share of the visible titles and axis/column labels the answer contains.
- `boxIoU`: mean best overlap between each true visual's box and the model's boxes.
- `inventedNumbers`: figures in the answer. Every value on the sample is masked, so each one was made up.

Runs on the CPU in Node (WebGPU exists only in browsers), so the timings say little about the browser. The first run
downloads each model (hundreds of MB to ~1.5 GB) from huggingface.co into the Transformers.js cache.
