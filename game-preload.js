// Game window preload — patches OffscreenCanvas to prevent WebGL2 crash in Electron.
// OffscreenRendererService.isOffscreenSupported() creates an OffscreenCanvas and checks
// for webgl2. If found, it uses OffscreenCanvas+WebGL2 for rendering, which crashes the
// Electron renderer (STATUS_ACCESS_VIOLATION, exit code 0xC0000005).
// By returning null for webgl2 on OffscreenCanvas, usesNativeOffscreen stays false and
// the service falls back to regular HTML canvas — no crash.

if (typeof OffscreenCanvas !== 'undefined') {
  const origGetContext = OffscreenCanvas.prototype.getContext;
  OffscreenCanvas.prototype.getContext = function (type, ...args) {
    if (type === 'webgl2' || type === 'experimental-webgl2') return null;
    return origGetContext.call(this, type, ...args);
  };
}
