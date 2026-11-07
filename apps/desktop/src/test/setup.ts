// jsdom has no layout or pointer capture. Browser checks cover real scrolling,
// collision handling and pointer interaction in both Chromium and WebKit.
import { vi } from "vitest";

if (!window.PointerEvent)
  window.PointerEvent = MouseEvent as typeof PointerEvent;
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};
globalThis.ResizeObserver ??= class {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
};
