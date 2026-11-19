# Developing Neuron

For installation and everyday use, see the [user guide](../README.md).

## Run from source

Development requires Node.js 22.12+ and Windows x64 with .NET Framework 4.x. The native helper is compiled using the Windows-provided C# compiler; no Visual Studio or custom driver is needed.

```powershell
npm install
npm start
```

After installing dependencies, you can also double-click `Start Neuron.cmd`.

## Check and build

```powershell
npm test            # protocol validation, profiles, rollback and macro cancellation
npm run smoke:workspaces # sidebar selection, per-mouse isolation, reconnects and DPI targeting
npm run smoke      # real Electron UI, native input into its own window, HID reads
node_modules/electron/dist/electron.exe scripts/razer-layout-smoke.cjs # offline Razer layout checks
npm run pack       # local Windows x64 folder, not a published release
npm run release:build # Windows x64 installer in dist/release
node scripts/probe.cjs # read-only Trinity diagnostics
```

The smoke test skips its native key-injection check if another application has foreground focus; it never types into that other app. The result JSON records whether the native check ran. Test profiles and screenshots use an isolated artifacts directory, separate from your normal settings.

`scripts/hardware-roundtrip.cjs` is an explicit hardware test: it briefly changes Trinity side button 1 to F24 and restores both original slots in `finally`, with a recovery snapshot in `artifacts`. Do not run it while gaming. It is intentionally excluded from normal tests.

The renderer is sandboxed, has no Node access or network permission, and talks through a fixed preload API. The main process validates IPC origins and profile payloads. The native helper handles Razer feature reports, read-only HID descriptor summaries, foreground process lookup, key state, and key taps. Hardware operations are serialized; single-instance locking prevents competing Neuron sessions.

`npm run smoke:onboard` tests the UI, macro restrictions, snapshot persistence, workspace switching, and actual quit sequence with simulated device writes. Physical persistence after unplugging or cycling power remains unverified.

`npm run smoke:dpi` checks the Electron page, validation, profile independence, reload, disconnection, and compact layout with isolated test profiles and a simulated DPI device. It does not write to physical hardware.

## Local builds

Open `dist/Neuron-win32-x64/Neuron.exe` for the local portable build. Keep the executable with the rest of its folder. No Node installation or administrator access is needed to run that build.

Development and portable builds do not install updates automatically. Use the Windows installer to switch to an installed copy.

## Technical references

- [Hardware implementation and validation](hardware.md)
- [Razer driver coverage and limitations](razer-drivers.md)
- [Hardware reporting service, deployment, and token renewal](hardware-reporting.md)
- [Protocol references and third-party dependencies](../THIRD_PARTY.md)
