// Keep the runtime self-hosted. In production the CDN can be protected by a
// proxy/auth layer and return an HTML 401 page, which ONNX Runtime then tries
// to compile as WebAssembly.
function ortAsset(name) {
  // Resolve at runtime so Vite does not mistake a public .mjs asset for a
  // source import during development.
  if (typeof window !== "undefined") {
    return new URL(`/ort-wasm/${name}`, window.location.href).href;
  }
  return `/ort-wasm/${name}`;
}

export function configureWasmRuntime(runtime) {
  runtime.env.wasm.numThreads = 1;
  runtime.env.wasm.proxy = false;
  runtime.env.wasm.wasmPaths = {
    mjs: ortAsset("ort-wasm-simd-threaded.mjs"),
    wasm: ortAsset("ort-wasm-simd-threaded.wasm"),
  };
  return runtime;
}

export function configureWebGpuRuntime(runtime) {
  runtime.env.wasm.numThreads = 1;
  runtime.env.wasm.proxy = false;
  runtime.env.wasm.wasmPaths = {
    mjs: ortAsset("ort-wasm-simd-threaded.asyncify.mjs"),
    wasm: ortAsset("ort-wasm-simd-threaded.asyncify.wasm"),
  };
  return runtime;
}
