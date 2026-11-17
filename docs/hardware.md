# Naga hardware implementation notes

## Remapping adapters and Mouse Dock Pro

The adapter registry in `app/drivers.cjs` separates physical USB IDs from selected mouse models. These are independently implemented protocol adapters, not bundled copies of other applications. All are experimental in Neuron; only Trinity has local physical verification.

| Mouse / connection | IDs | Side plates | Write storage |
| --- | --- | --- | --- |
| Trinity | `0067` | 7, 12 | Pending 2, then active 1 (existing behavior) |
| Naga Pro wired / receiver | `008F`, `0090` | 2, 6, 12 | Live 0 |
| Naga V2 Pro wired / receiver | `00A7`, `00A8` | 2, 6, 12 | Live 0 |
| Naga V3 Pro wired / receiver | `00E7`, `00E8` | 2, 6, 12 | Live 0 |
| Naga V2 HyperSpeed receiver | `00B4` | 12 | Stored 1, then live 0 |
| V2/V3 Pro via Mouse Dock Pro | `00A4` transport | 2, 6, 12 | Live 0, transaction `1F` to the paired mouse |

Modern remapping uses class `02`, GET `8C` / SET `0C`, size `0A`, transaction `1F`. Twelve-button plates use sources `40..4B`, six-button plates use `50..55`, and the two-button plate uses front `05` / rear `04`. Body controls use the published model-specific source table. V2 Pro's front/rear wheel-stage buttons are `6D` / `60`, not Trinity's `0B` / `0C`. Extra V3 controls, the underside profile button, Hypershift, Bluetooth configuration, onboard macro storage, and non-Trinity DPI controls are not exposed in this change.

Every affected assignment is read before writing; originals are durably saved, each change is read back, and failures trigger rollback. Modern backups preserve the full seven-byte function block: factory keyboard blocks can advertise length 1 while carrying the key usage in the second data byte. The returned layer flag is not a reliable request echo; normal-layer writes and restoration explicitly address layer 0. Pro-family changes use only the live layer; they do not promise persistence after power loss or a hardware profile change. HyperSpeed's stored layer is backed up and restored along with its live view.

The submitted Dock Pro report (`1532:00A4`, release `0101`) contains nine HID collections. Only the interface-0 mouse collection anchors the connection; the interface-1 mouse and keyboard/consumer collections do not become extra devices. Read-only `00:BF` asks for paired devices (`count`, followed by connected flag and big-endian PID triples). A single recognized V2/V3 Pro selects its adapter. Unavailable, ambiguous, or unsupported answers show a mouse-choice prompt on Devices. This probe is cached for 30 seconds and cleared on disconnect. A manual choice overrides identification and is saved per connection, without changing its transport PID. Other docked models and non-Razer receivers cannot acquire a Naga driver through manual selection.

Dock lighting uses a different transaction (`FF`) from the paired mouse (`1F`); Neuron does not configure dock lighting. Dock backups include the selected mouse model in their local key. Restore the active mouse before changing a dock's selected model. A saved choice describes the user-selected model, not proof that the mouse is currently awake or still paired. Moving a dock to a port that changes its HID path may require selecting again.

Protocol evidence:

- [OpenSnek USB button protocol](https://github.com/gh123man/OpenSnek/blob/main/docs/protocol/USB_PROTOCOL.md), including full function blocks and layer handling.
- [Naga Pro physical side-panel validation](https://github.com/gh123man/OpenSnek/blob/main/captures/usb/2026-10-06-naga-pro-side-panel-validation/README.md).
- [V2 Pro receiver and wired capture](https://github.com/gh123man/OpenSnek/blob/main/captures/usb/2026-10-07-naga-v2-pro-buttons/README.md).
- [V3 Pro receiver](https://github.com/gh123man/OpenSnek/blob/main/captures/usb/2026-10-17-naga-v3-pro/README.md) and [wired validation](https://github.com/gh123man/OpenSnek/blob/main/captures/usb/2026-10-18-naga-v3-pro-wired/README.md).
- [OpenNaga HyperSpeed verification](https://github.com/Zer0codestuff/OpenNaga/blob/main/Documentation/onboard-verification-2026-09-11.md) and [binding codec](https://github.com/Zer0codestuff/OpenNaga/blob/main/Sources/NagaController/Hardware/RazerOnboardBindings.swift).
- [OpenMouse's V2 Pro dock passthrough report](https://github.com/OpenMouse-Project/mouse-protocol/blob/main/docs/razer-testing.md), which establishes settings transport, not button-remapping verification by itself.
- Secretarybird's [dock identification and separate transaction IDs](https://github.com/infinityInfinite/secbird/blob/main/crates/secbird-core/src/device.rs), [button implementation](https://github.com/infinityInfinite/secbird/blob/main/crates/secbird-core/src/buttons.rs), and [command definitions](https://github.com/infinityInfinite/secbird/blob/main/crates/secbird-core/src/commands.rs).

Neuron's new adapters have simulated transport tests for exact restoration, wrong model/plate rejection, lost acknowledgements, rollback, and automatic profile selection. They still need Windows hardware acceptance testing on each model/transport. An upstream hardware capture establishes protocol evidence; it does not mean Neuron has been physically tested on that device. Older Naga models remain discovery-only where a sufficiently supported remapping protocol has not been established.

## Compx receiver recognition

The supplied Windows report identifies VID `3554`, PID `F55D`, release `0300`, manufacturer `Compx`, product `2.4G Wireless Receiver`. Its eight HID collections include keyboard (interface 0), system/consumer and vendor pages `FF02`–`FF05` (interface 1), and mouse usage page `0001` / usage `0002` (interface 2).

Neuron recognizes the interface-2 mouse collection as one receiver and uses its path to distinguish attached units. Other collections are not separate mice or assumed configuration endpoints. Existing Naga device IDs and recovery backup keys are unchanged. Recognition only enumerates HID metadata; it sends no feature reports to the receiver. The Devices page and tray explicitly report limited support and unknown battery status. The receiver stays outside the profile catalog and automatic switching, and remains eligible for unsupported-hardware reporting.

The USB ID alone cannot select a driver: both [m913-ctl's Compx M913 revision](https://github.com/Qehbr/m913-ctl) and [g49-web-control's G49 / M916 Pro 1K variants](https://github.com/dongkid/g49-web-control) document `3554:F55D`. No model, button count, sensor, configuration format, or battery command is inferred from this report. Enabling configuration requires additional model/board identification, protocol evidence for that variant, and verified backup/readback/restore behavior. Recognition is tested against all eight reported collections. Read-only enumeration on this computer also detected one matching receiver alongside a Naga Trinity; receiver configuration has not been tested.

Local identification evidence: installed **Redragon M990-WL Gaming Mouse 1.0.2.0** software has `Sys64/usersetting/Config.ini` values that decode to VID `3554`, wireless PID `F55D`, and wired PID `F55E`, with a configured `MID=48`. This makes M990-WL a strong candidate for this computer’s receiver, but installed software and its configured MID are not a live model response. Do not label every receiver with this shared ID as M990-WL.

## Verified locally, 2026-11-17

Windows reported a Naga Trinity, VID `1532`, PID `0067`. The mouse collection on interface `MI_00`, usage page 1 / usage 2, accepts feature reports when opened with `CreateFile` desired access 0 and shared read/write. Other tested keyboard and vendor collections returned Win32 error 1. No driver replacement, elevated service, or Synapse process was used.

The bridge prepends report ID zero to a 90-byte Razer payload. HID request and response buffers are 91 bytes. A reply must have status 2, a valid XOR checksum, and matching command and transaction IDs before it is consumed. Enumeration runs asynchronously through node-hid. Blocking feature-report calls run in a separate native process, not Electron's UI thread.

## Trinity side bindings

Class `02`, GET `8c`, SET `0c`, size `0a`, transaction `1f`. Arguments are profile slot, source ID, layer zero, action type, parameter count, and parameters. Keyboard action is type 2 with modifier mask and HID usage. The 12-button sources are `40..4b`; the documented 7-button sources are `50..56`.

Write slot 2 (pending) before slot 1 (active). **Rewriting slot 1 alone produced Win32 error 31 on the connected unit.** Pairing the pending and active writes succeeded. This is required even when the pending mapping already equals the requested mapping. Do not optimize away that staging write if either slot changes. Both stages are verified by reading their stored mappings.

The hardware roundtrip captured side button 1's original values: active slot `[type=2, modifiers=0, usage=0x68]` and pending slot `[type=2, modifiers=7, usage=0x1e]`. It temporarily set both to F24 (`0x73`), verified the new active mapping, restored the two distinct original values in pending/active order, and verified exact restoration. The evidence is in local `artifacts/hardware-roundtrip.json`. These original values are specific to the attached mouse, not factory defaults.

The normal Apply path reads all affected original slots, saves a durable backup, writes changed source pairs, and reads back each change. On failure it attempts to roll back to the pre-apply snapshot. A separate original snapshot is retained across successful changes. The app does not set device mode, firmware, lighting, or undocumented source IDs. Explicitly configured top controls and current DPI can be changed; their originals are backed up first.

## Current DPI

Trinity uses class `04`, GET `85` / SET `05`, payload size `07`, transaction `1f`. The runtime-store selector is zero, followed by big-endian 16-bit X and Y values and two reserved zero bytes. The implementation reads the same store after a write and requires an exact match. Protocol references: [OpenRazer DPI reports](https://github.com/openrazer/openrazer/blob/master/driver/razerchromacommon.c) and the Trinity reference linked below. A read from the connected mouse returned 1800 on both axes on 2026-11-17. Actual DPI writes have not yet been physically acceptance-tested here.

DPI is controlled through a separate device operation and is excluded from button profiles, including legacy imports. Before the first DPI mutation, the original is added to the durable device backup. DPI failures roll back sensitivity without touching mappings. Applying or automatically restoring a button profile and quitting leave DPI unchanged. An explicit Restore original restores both settings, including DPI-only backups. The onboard stage table is not rewritten. Automated tests cover encoding, validation, profile independence, first-original retention, rollback, and readback failure.

## Limits and next validation

The follow-up modifier check (`scripts/modifier-roundtrip.cjs`) wrote and read back `Ctrl`, `Shift`, `Alt`, `Ctrl+Shift`, and `Ctrl+1`, then restored both original slots. Modifier-only bindings use keyboard action type 2 with a modifier mask and keyboard usage zero. That verifies storage acceptance, not physical press/release behavior; use the live keyboard view to validate the latter on the actual mouse. A modifier-only macro step remains a tap; the held behavior belongs to direct mouse bindings.

- Physically test all 12 button positions, modifier chords, disabled bindings, and macros in a game.
- Validate a real 7-button plate before promoting it from experimental.
- Add device adapters separately for each Naga generation/connection, supported by protocol evidence and actual hardware testing. The device catalog is discovery metadata, not proof of driver compatibility.
- Add raw input or an appropriate native event path if device-specific macro triggers, held-key actions, or Hypershift become requirements. The current F13–F24 global shortcuts are system-wide and cannot identify the originating keyboard.
- Verify profile switching latency and wear characteristics before treating frequent onboard writes as a final architecture. Host-side binding execution could avoid repeated stored-profile writes but must preserve key-up and device isolation.
- Verify recovery after real disconnection during a write. Unit tests cover partial writes and rollback, but cannot establish every firmware's behavior under power loss.

## Primary references

- [OpenRazer device IDs](https://github.com/openrazer/openrazer/blob/master/driver/razermouse_driver.h).
- [Trinity capture notes](https://github.com/cepheiden/Razer-Naga-Trinity-MACOS/blob/main/CLAUDE.md), especially the Wireshark-decoded side-button section. Earlier statements in that file about unimplemented writes are superseded by its later capture notes.
- [Trinity source mapping reference](https://github.com/cepheiden/Razer-Naga-Trinity-MACOS/blob/main/electron/sideBindings.ts) and [transport reference](https://github.com/cepheiden/Razer-Naga-Trinity-MACOS/blob/main/electron/nagaDriver.ts).
- [Microsoft HidD_SetFeature](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/hidsdi/nf-hidsdi-hidd_setfeature) and [SendInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput).
