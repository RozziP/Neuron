const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const MAX_INSTALLER_SIZE = 500 * 1024 * 1024;

function installerAsset(release, version) {
  const name = `Neuron-Setup-${version}-x64.exe`;
  const url = `https://github.com/RozziP/Neuron/releases/download/${encodeURIComponent(release.tag_name)}/${encodeURIComponent(name)}`;
  const assets = release.assets?.filter(asset => asset.name === name) || [];
  const asset = assets[0];
  if (assets.length !== 1 || asset.state !== 'uploaded' || asset.browser_download_url !== url ||
      !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > MAX_INSTALLER_SIZE ||
      !/^sha256:[a-f0-9]{64}$/i.test(asset.digest || '')) return null;
  return { name, url, size: asset.size, sha256: asset.digest.slice(7).toLowerCase() };
}

async function downloadInstaller(asset, directory, onProgress, { fetchDownload = fetch, signal, stallTimeoutMs = 30000 } = {}) {
  if (!asset) throw new Error('This release does not contain a verified Windows installer. Try checking for updates later.');
  await fs.mkdir(directory, { recursive: true });
  const attempt = await fs.mkdtemp(path.join(directory, 'update-'));
  const file = path.join(attempt, asset.name), partial = file + '.part';
  let handle, stallTimer;
  const stalled = new AbortController();
  signal = AbortSignal.any([stalled.signal, ...(signal ? [signal] : [])]);
  const resetTimeout = () => {
    clearTimeout(stallTimer);
    stallTimer = setTimeout(() => stalled.abort(new DOMException('Update download stalled.', 'TimeoutError')), stallTimeoutMs);
    stallTimer.unref?.();
  };
  try {
    resetTimeout();
    onProgress(0, { received: 0, total: asset.size });
    let url = asset.url, response;
    for (let redirects = 0; redirects <= 5; redirects++) {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password ||
          !['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(parsed.hostname)) {
        throw new Error('The update download redirected to an unexpected location.');
      }
      response = await fetchDownload(url, { redirect: 'manual', signal, headers: { 'User-Agent': 'Neuron' } });
      resetTimeout();
      if (![301,302,303,307,308].includes(response.status)) break;
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location || redirects === 5) throw new Error('The update download redirected too many times.');
      url = new URL(location, url).href;
    }
    if (!response.ok || !response.body) throw new Error('Could not download the update. Check your connection and try again.');
    const length = response.headers.get('content-length');
    if (length !== null && Number(length) !== asset.size) throw new Error('The update download has an unexpected size.');
    handle = await fs.open(partial, 'wx');
    const hash = createHash('sha256');
    let received = 0, lastProgress = 0, lastReport = Date.now();
    for await (const chunk of response.body) {
      signal?.throwIfAborted();
      resetTimeout();
      received += chunk.length;
      if (received > asset.size) throw new Error('The update download exceeded its expected size.');
      hash.update(chunk);
      await handle.writeFile(chunk);
      const progress = Math.floor(received / asset.size * 100);
      if (progress !== lastProgress || Date.now() - lastReport >= 250) {
        onProgress(progress, { received, total: asset.size }); lastProgress = progress; lastReport = Date.now();
      }
    }
    signal.throwIfAborted();
    if (received !== asset.size || hash.digest('hex') !== asset.sha256) throw new Error('The update failed verification. Please try again.');
    await handle.close(); handle = null;
    await fs.rename(partial, file);
    return { file, sha256: asset.sha256, discard: async () => {
      await fs.rm(file, { force: true }).catch(() => {});
      await fs.rmdir(attempt).catch(() => {});
    } };
  } catch (error) {
    await handle?.close().catch(() => {});
    await fs.rm(partial, { force: true }).catch(() => {});
    await fs.rmdir(attempt).catch(() => {});
    throw signal.aborted ? signal.reason : error;
  } finally { clearTimeout(stallTimer); }
}

module.exports = { installerAsset, downloadInstaller, MAX_INSTALLER_SIZE };
