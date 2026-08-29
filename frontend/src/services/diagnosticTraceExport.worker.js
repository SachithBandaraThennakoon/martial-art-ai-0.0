globalThis.onmessage = async (event) => {
  try {
    const payload = JSON.stringify(event.data);
    let blob = new Blob([payload], { type: "application/json" });
    let compressed = false;
    if (typeof CompressionStream === "function") {
      const stream = blob.stream().pipeThrough(new CompressionStream("gzip"));
      blob = await new Response(stream).blob();
      compressed = true;
    }
    globalThis.postMessage({ blob, compressed });
  } catch (error) {
    globalThis.postMessage({
      error: error instanceof Error ? error.message : String(error)
    });
  }
};
