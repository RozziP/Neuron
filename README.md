# Neuron

A Windows desktop control center for Razer Naga mice. The first milestone is button rebinding, macros, and game profiles. All Naga generations are the compatibility target; **this build has a working experimental Trinity driver, not universal Naga support**.

## Run

Open `dist/Neuron-win32-x64/Neuron.exe` for the local portable build. Keep the executable with the rest of its folder. No Node installation or administrator access is needed for that build.

For the development checkout, double-click `Start Neuron.cmd` after installing dependencies, or use:

```powershell
npm install
npm start
```

Development requires Node.js 22.12+ and Windows x64 with .NET Framework 4.x. The native helper is compiled using the Windows-provided C# compiler; no Visual Studio or custom driver is needed.

## Use

1. Close Synapse so it does not compete with Neuron for settings.
2. Select the correct model and attached side plate. Trinity 12-button is the hardware-tested starting point; 7-button support is experimental and not physically tested.
3. Click a side or top mouse control, then **Click here, then press a key** to capture a shortcut. To use a modifier by itself, press and release it during capture. Modifier-only combinations such as `Ctrl+Shift` are also supported. Escape cancels capture; you can assign Escape by clicking it on the virtual keyboard .
4. Click **Save & apply to mouse** at the top to save the profile, write its button mappings, and verify readback. Save profile in the sticky header saves locally without changing your mouse. Top controls start as Original and remain unchanged until you rebind them. Returning to Original restores the saved mapping. Keep Left click assigned somewhere. Sensitivity is controlled separately in the DPI tab. Lighting is unchanged.
5. **Test on virtual keyboard** opens a keyboard that highlights keys while held and clears them on release. Press your physical keyboard or mapped mouse buttons with Neuron focused. Clicking a virtual key assigns it to the currently selected mouse button. The virtual keyboard replaces the old bindings overview.
5. Macros has its own shared library and Save macros action, without a profile selector. To create a macro, add key taps and millisecond delays or record keys while Neuron has focus. Recording appends to the sequence and stops on Escape or loss of focus. Assign it from Button mapping → Macro. A macro has a fixed repeat count, at most 100 steps and two minutes of total playback. Overlapping macro triggers are ignored.
6. `Ctrl+Alt+Escape`, the footer button, and the tray menu stop a running macro. Closing the window keeps Neuron in the tray. **Restore mouse and quit** restores the original hardware bindings before exiting.

Macro buttons use F13–F24 on the mouse, with corresponding global shortcuts reserved while that profile is applied. Other keyboards emitting those same F-keys can also trigger the macro. Playback uses Windows SendInput and requires Neuron to stay running; macros are not stored onboard. Key steps are taps, not held-key sequences. Physical key positions follow the USB/US keyboard map; layout-dependent symbols may differ on other keyboard layouts. Windows does not allow a normal-privilege app to inject input into an elevated app.

## DPI

Open **DPI**, set 100–16,000 DPI with the sliders, exact inputs, or quick picks, then click **Apply DPI**. Unlink the axes for independent horizontal and vertical sensitivity. **Read DPI** reads the connected Trinity without changing it.

Sensitivity is mouse-wide. Saving, applying, importing, or switching button profiles does not change it. Neuron reads the current mouse sensitivity when opening DPI; it does not store DPI in profiles. Leaving a game or quitting Neuron restores button mappings without changing sensitivity. **Restore original** on Devices explicitly restores both mappings and the first backed-up DPI.

This controls current sensitivity only; the mouse's DPI buttons still cycle its existing onboard stages. It does not rewrite those stages or guarantee persistence after unplugging the mouse. Other Naga models remain unsupported for hardware writes.

`npm run smoke:dpi` checks the Electron page, validation, profile independence, reload, disconnection, and compact layout with isolated test profiles and a simulated DPI device. It does not write to physical hardware.

## Game profiles

Open **Button mapping → Game profiles → Your games**. Neuron detects installed games from Steam libraries, Battle.net / WoW clients, Epic manifests, GOG, Riot, Windows install records, and common game folders across local drives. Use **Add game** for custom locations. Select a game, choose fresh bindings or a saved standard profile, then click **Create game profile**. **Import profile from file** copies a Neuron JSON profile into that game. Each game gets independent button bindings. Macros live in a shared library and can be assigned in any profile. WoW Retail and Forever are separate entries matched by full executable path, even though both use `Wow.exe`.

Automatic switching is always enabled as soon as a game profile exists, including after restarting Neuron; there is no toggle and no initial manual apply requirement. Neuron checks the foreground app once a second, waits for it to settle, and applies the matching profile. It returns to the desktop profile for unmatched apps and ignores its own window. Switching performs verified hardware writes and is not instantaneous. Disconnected mice resume on reconnect. Failed automatic writes display an error and retry after a short delay. If no compatible desktop profile exists, Neuron restores the original mouse mappings when leaving the game.

Import/export uses versioned `.json` files. New imported profiles get new IDs. Only one profile per game/model/side-plate combination is allowed. Imported templates must match the selected mouse and plate. Automatic discovery is best effort; an unusual executable may need selecting or locating manually.

## Hardware status

| Capability | Status |
| --- | --- |
| Discover known Naga USB identities | 17 identities in the catalog |
| Trinity: read 12 side-button mappings | Verified on connected `1532:0067` hardware |
| Trinity: change a mapping and restore it | Verified with a temporary F24 mapping, then exact restoration of both original slots |
| Trinity: Ctrl, Shift, Alt, Ctrl+Shift, Ctrl+1 mappings | Hardware write/readback verified; physical hold/release acceptance testing remains |
| Trinity: disable, 7-button plate | Implemented, needs physical acceptance testing |
| Windows macro playback | Verified into the app's focused test field |
| Profile persistence and UI flows | Automated tests |
| Automatic game switching | Implemented; needs acceptance testing in real games |
| Other Naga models, Bluetooth, new USB identities | Planned; hardware writes disabled |
| Trinity top controls (clicks, wheel, tilt, DPI buttons) | Editable; all mappings read from hardware, DPI-up rebind/readback/restore verified; physical press testing remains |
| 2-button plate, Hypershift, onboard macros | Planned |
| Trinity current DPI | Mouse-wide X/Y sensitivity with verified readback and rollback; hardware reads verified, physical write acceptance pending |
| DPI stages, polling rate, lighting | Planned |

An experiment on one Trinity does not verify every firmware revision. See [hardware notes](docs/hardware.md) for the transport and observed behavior.

## Data and recovery

Normal app data lives under `%APPDATA%/Neuron` (Electron's `userData` directory): `profiles.json`, a `games.json` discovery cache, and a `backups` folder containing original mouse mappings. Macros and button profiles are stored together in version 2 of profiles.json, with shared macro definitions stored once. Existing per-profile macros are migrated with a backup; differing definitions that reused an ID are preserved separately. Exported profiles retain the portable version 1 format. Writes are atomic. Invalid profile files are preserved as recovery copies. Hardware originals are saved **before** any configuration writes and are not overwritten by later profile applications.

Apply failures attempt to restore the immediately preceding mappings. Devices → Restore original restores the pre-Neuron snapshot. If the process is killed, the PC shuts down, or USB is unplugged mid-write, automatic restoration cannot be guaranteed. Reconnect and use Restore original. Keep backups when resetting app data. A matching game profile is automatically applied when its game is in front, including after startup.

## Automatic hardware reports

Neuron 0.1.1 automatically sends unsupported-mouse hardware metadata to its reporting service, which creates a public issue in [RozziP/Neuron](https://github.com/RozziP/Neuron) only when no matching open or closed issue exists. No login, prompt, or browser interaction is required. Reports include mouse model/USB IDs, HID interface details, and app/OS versions; serial numbers, device paths, profiles, games, and input events are excluded.

The reporting service is live on Cloudflare Workers Free. Reports are also saved locally, successful submissions are remembered, and failed attempts retry automatically. Mouse-capable interfaces on receivers or composite devices may need maintainer triage. See [deployment, token renewal, and duplicate handling](docs/hardware-reporting.md).

## Check and build

```powershell
npm test            # protocol validation, profiles, rollback and macro cancellation
npm run smoke      # real Electron UI, native input into its own window, HID reads
npm run pack       # local Windows x64 folder, not a published release
node scripts/probe.cjs # read-only Trinity diagnostics
```

The smoke test skips its native key-injection check if another application has foreground focus; it never types into that other app. The result JSON records whether the native check ran. Test profiles and screenshots use an isolated artifacts directory, separate from your normal settings.

`scripts/hardware-roundtrip.cjs` is an explicit hardware test: it briefly changes Trinity side button 1 to F24 and restores both original slots in `finally`, with a recovery snapshot in `artifacts`. Do not run it while gaming. It is intentionally excluded from normal tests.

The renderer is sandboxed, has no Node access or network permission, and talks through a fixed preload API. The main process validates IPC origins and profile payloads. The native helper only handles Razer feature reports, foreground process lookup, key state, and key taps. Hardware operations are serialized; single-instance locking prevents competing Neuron sessions.

This project is independent of Razer and is not affiliated with or endorsed by Razer. Protocol references and third-party dependencies are recorded in [THIRD_PARTY.md](THIRD_PARTY.md).
