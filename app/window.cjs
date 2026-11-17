function createWindowOpener({ getWindow, createWindow, canOpen = () => true }) {
  let opening = null;
  return async function showWindow() {
    if (!canOpen()) return;
    if (opening) return opening;
    const current = getWindow();
    if (current && !current.isDestroyed()) {
      if (current.isMinimized()) current.restore();
      current.show(); current.focus();
      return current;
    }
    // Defer creation so concurrent launch/tray events share the same promise.
    opening = Promise.resolve().then(createWindow).then(window => {
      if (!canOpen() || window.isDestroyed()) return;
      if (window.isMinimized()) window.restore();
      window.show(); window.focus();
      return window;
    });
    try { return await opening; }
    finally { opening = null; }
  };
}
module.exports = { createWindowOpener };
