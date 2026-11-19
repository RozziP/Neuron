# Neuron

Neuron is a Windows app for customizing your mouse buttons, creating keyboard macros, and switching bindings automatically for each game. Profiles stay on your computer, with separate settings and macro libraries for each mouse.

**Mouse support is experimental.** Naga Trinity has the most direct hardware testing; Redragon M990-WL has limited wireless testing. Many other Razer models are available, but their drivers still need physical validation. Check [mouse compatibility](#mouse-compatibility) before applying settings.

## Install

1. Download the Windows x64 installer from [the latest release](https://github.com/RozziP/Neuron/releases/latest).
2. Run the downloaded **Neuron Setup** executable.
3. Launch **Neuron** from the Start menu.

You do not need Node.js or administrator access. The installer is currently unsigned, so Windows may show an unknown-publisher warning. If Neuron is already installed, run the new installer directly; your saved profiles and macros are retained.

## Set up your first button

1. Connect your mouse using USB or its supported receiver, and close Synapse or Redragon's configuration software so it does not compete with Neuron.
2. Select your mouse under **Your devices** in the sidebar. If a dock or receiver asks which mouse is paired, choose the correct model. Select the attached side plate where applicable. To prepare profiles without a connected mouse, use **Devices → Select your mouse**.
3. Open **Button mapping** and click the side or top control you want to change.
4. Choose **Click here, then press a key** and press your shortcut. To assign a modifier such as Ctrl alone, press and release it. Combinations such as Ctrl+Shift also work. Escape cancels capture; use the virtual keyboard to assign Escape.
5. Click **Save & apply to mouse**. Neuron saves the profile and writes and checks the mouse's bindings.
6. Open **Test on virtual keyboard**, keep Neuron focused, and press the mapped mouse button to check the result. Clicking a virtual key assigns it to the selected button.

Keep **Left click** assigned somewhere. Controls set to **Original** retain their original mapping; choose Original again to undo a rebind. **Save profile** saves your edits locally without applying them to the mouse. DPI is adjusted separately, and lighting is unchanged.

## Profiles for your desktop and games

Use **Profiles** to create, duplicate, rename, import, or export standard profiles. Exported profiles are `.json` files; imports must match the selected mouse and side plate.

To set up a game:

1. Open **Button mapping → Game profiles → Your games**.
2. Select a detected game, or use **Add game** to locate one manually.
3. Start with fresh bindings or a saved standard profile, then click **Create game profile**. You can also use **Import profile from file**.
4. Customize the bindings and save your changes.

**Game switching starts automatically as soon as a game profile exists.** Keep Neuron running, including in the tray. When a game becomes the foreground app, Neuron applies its profile after a short delay. Switching to another app returns to your desktop profile, or to saved onboard bindings or original mappings if no compatible desktop profile exists. WoW Retail and Forever are treated as separate games even though both use `Wow.exe`.

Each mouse has its own profiles and macros, including two mice of the same model. All pages and automatic game switching use the mouse selected in the sidebar. Switching mice restores the previous mouse's active bindings and prompts before discarding unsaved edits. Wired and wireless connections can appear as separate mouse workspaces.

## Create and use macros

1. Open **Macros** and choose **New macro**.
2. Add key presses and delays, or choose **Record keys** while Neuron has focus. Recording appends to the sequence and stops on Escape or when the window loses focus.
3. Choose how it plays:
   - **Do once** plays the sequence once.
   - **Do X times** repeats it a set number of times.
   - **Toggle (repeat indefinitely)** starts on one press and stops on the next press of the same button.
   - **Continuous while held** stops when you release the button, including during a delay.
4. Click **Save macros**, then open **Button mapping → Macro** and choose the saved macro for a mouse button.
5. Click **Save & apply to mouse**.

**Stop playback at any time with Ctrl+Alt+Escape**, the footer's **Stop macro** button, or the tray menu.

Macros are shared across the selected mouse's profiles. Each sequence supports up to 100 steps; key steps are taps, not held-key sequences. Neuron must stay running because macros are not stored on the mouse. Only one macro plays at a time.

Macro bindings reserve F13–F24 while applied, so those keys on another keyboard can also trigger playback. Neuron cannot send input into an app running at a higher privilege level. Keys follow the USB/US keyboard map, so some symbols may differ on other layouts.

## Adjust sensitivity (DPI)

Open **DPI**, wait for the current sensitivity to load, then use the sliders, exact inputs, or quick picks and click **Apply DPI**. Unlink the axes to set horizontal and vertical sensitivity separately. **Read DPI** refreshes the value without changing it; applying stays disabled until a read succeeds.

| Mouse | DPI range |
| --- | --- |
| Naga Trinity | 100–16,000 |
| Naga X | 100–18,000 |
| Naga Pro / Left-Handed Edition 2020 | 100–20,000 |
| Naga V2 Pro / V2 HyperSpeed | 100–30,000 |
| Naga V3 Pro | 100–50,000 |
| Redragon M990-WL | 50–26,000, in steps of 50 |

Use USB or a supported receiver. Mouse Dock Pro supports identified V2/V3 Pro mice; Bluetooth DPI configuration is unavailable.

DPI is mouse-wide and is not saved in button profiles. Switching profiles, leaving a game, or quitting Neuron does not change it. On Naga models, the mouse's DPI buttons still cycle its existing onboard stages; persistence after unplugging is not guaranteed. M990-WL edits only the active onboard stage. Use **Read DPI** again after pressing its DPI or onboard-profile buttons.

## Keep bindings after quitting (Naga Trinity)

In **Button mapping**, choose your Trinity profile and click **Save onboard**. This saves and applies its bindings and remembers them as the set to restore when Neuron quits, installs an update, or switches to another mouse.

Key/modifier, mouse-button, Original, and disabled assignments are supported. Replace any assigned macros first; unused macros in the library are fine. DPI is unchanged.

Normal profile edits, **Save & apply to mouse**, and game switching do not replace this saved set. Click **Save onboard** again to replace it, or **Devices → Restore original** to clear it and restore the original settings. This does not manage multiple hardware profile slots, and persistence after unplugging or power cycling remains unverified. Automatic game switching still needs Neuron running.

## Tray and updates

Closing the window keeps Neuron running in the system tray for macros and game switching. To fully exit, right-click the tray icon and choose **Quit**. Neuron returns the mouse to saved onboard bindings where available, or its original mappings.

Supported wireless mice show battery and charging status in the tray. Orange means 20% or less; blue means charging. Hover or right-click for details. Battery support varies by model and connection, and most wireless Razer readings still need physical verification.

Neuron checks for updates at startup and every six hours. You can also select **Check for updates** in the sidebar:

1. Click **Download v…** to download in the background. You can keep editing or cancel the download.
2. When ready, click **Install and restart**. Finishing a download never starts installation by itself.
3. Save or discard pending edits when prompted, or cancel installation.

Neuron verifies the download, restores the mouse's saved onboard or original bindings, and restarts after installation. Saved profiles and macros are retained. Versions older than v0.1.7, and portable or development builds, need a manual installer update.

## Mouse compatibility

Check **Devices** for your model and connection's status. Detection alone does not mean a mouse supports configuration.

| Mouse or connection | What to expect |
| --- | --- |
| Naga Trinity | Most directly tested, especially the 12-button plate. Other plates and some assignments still need physical testing. |
| Naga Pro, V2 Pro, V3 Pro, V2 HyperSpeed, and other Razer models | Experimental or best-guess drivers; model-specific controls and connection support vary. |
| Mouse Dock Pro with V2/V3 Pro | Experimental remapping, DPI, and battery reads. Select the paired model if prompted. |
| Redragon M990-WL | Experimental 16-side-button mapping, macros, battery, and active-stage DPI. Wireless side-button 1 and DPI changes/restoration were physically tested; wired use remains untested. Top-button remapping is unavailable. |
| Bluetooth | Offline profile editing only; mouse configuration is unavailable. |
| Unidentified Compx receiver | Recognition only until a supported mouse is verified. Choosing a name alone does not enable configuration. |

Keep wireless mice awake when applying settings. Some bindings may reset after power cycling or changing the mouse's onboard profile. Hypershift, onboard macros, polling-rate controls, and lighting configuration are not available.

See [Razer driver coverage](docs/razer-drivers.md) and [hardware notes](docs/hardware.md) for detailed model support and testing limits.

## Troubleshooting and recovery

- **Mouse missing or settings unavailable:** open **Devices**, click **Refresh**, check the connection and selected model/plate, and close other mouse configuration apps. Bluetooth and unsupported receivers cannot apply settings.
- **Bindings behave unexpectedly:** open **Devices → Restore original**. This restores the settings backed up before Neuron changed them, including backed-up DPI, and clears saved onboard bindings. A game profile can still apply while its game is in front.
- **Neuron was force-closed or the mouse disconnected during a write:** reconnect and use **Restore original**. Automatic restoration cannot be guaranteed after an interruption.
- **Macro does nothing:** confirm it was saved, assigned, and applied, keep Neuron running, and check that the target app is not running at a higher privilege level.
- **Update fails:** Neuron shows an error so you can retry. You can also download and run the latest installer without uninstalling first.

Settings and original-mouse backups live in `%APPDATA%/Neuron`. Back up that folder before resetting app data; deleting it can remove the original settings needed for recovery. Use profile export for portable copies of individual profiles.

## Automatic hardware reports

Neuron automatically reports unsupported-mouse identification details to a service that creates or updates a public issue in [RozziP/Neuron](https://github.com/RozziP/Neuron/issues). No login or confirmation is required. Reports include USB IDs and labels, device capabilities, Windows driver descriptions, matching mouse-software evidence where supported, and app/OS versions.

Reports exclude serial numbers, device paths, profiles, games, input events, full configuration files, and unrelated installed software. **Devices → mouse identification** lets you confirm or correct a suggested model; that answer is included in reports. Failed submissions retry automatically. See [hardware reporting details](docs/hardware-reporting.md).

## Development and credits

For source setup, builds, and tests, see the [development guide](docs/development.md).

Neuron is independent of Razer and is not affiliated with or endorsed by Razer. Protocol references and third-party dependencies are listed in [THIRD_PARTY.md](THIRD_PARTY.md).
