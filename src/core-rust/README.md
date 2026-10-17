# vaultsnip-core (Rust → WASM)

Port of `classify()` from `web/app.js`. One dependency (`wasm-bindgen`), no network, no I/O.

## Build and test

Prerequisites: Rust (https://rustup.rs), `rustup target add wasm32-unknown-unknown`, `cargo install wasm-pack`, Node 20+.

```sh
npm install
npm run test:rust    # Rust unit tests (native)
npm run build:wasm   # writes public/wasm/vaultsnip_core.js + vaultsnip_core_bg.wasm
npm run test:unit    # Vitest: bridge tests + JS-vs-Rust parity (20k strings) + 50 ms benchmark
```

The parity and benchmark tests skip themselves until `public/wasm/` exists.
Report the output of all three; the Rust code was written without being compiled.
