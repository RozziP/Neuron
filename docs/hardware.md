# Naga hardware implementation notes

The broader Razer catalog, best-guess family drivers and model-specific control
layouts are documented in [Razer driver coverage](razer-drivers.md).

## Remapping adapters and Mouse Dock Pro

The adapter registry in `app/drivers.cjs` separates physical USB IDs from selected mouse models. These are independently implemented protocol adapters, not bundled copies of other applications. All are experimental in Neuron; only Trinity has local physical verification.

| Mouse / connection | IDs | Side plates | Write storage |
| --- | --- | --- | --- |
| Trinity | `0067` | 2, 7, 12 | Pending 2, then active 1 (existing behavior) |
| Naga Pro wired / receiver | `008F`, `0090` | 2, 6, 12 | Live 0 |
| Naga V2 Pro wired / receiver | `00A7`, `00A8` | 2, 6, 12 | Live 0 |
| Naga V3 Pro wired / receiver | `00E7`, `00E8` | 2, 6, 12 | Live 0 |
| Naga V2 HyperSpeed receiver | `00B4` | 12 | Stored 1, then live 0 |
| V2/V3 Pro via Mouse Dock Pro | `00A4` transport | 2, 6, 12 | Live 0, transaction `1F` to the paired mouse |

Modern Naga remapping uses class `02`, GET `8C` / SET `0C`, size `0A`, transaction `1F`. Twelve-button plates use sources `40..4B`, six-button plates use `50..55`, and the two-button plate uses front `05` / rear `04`. Body controls use the published model-specific source table. V2 Pro's front/rear wheel-stage buttons are `6D` / `60`, not Trinity's `0B` / `0C`; these are exposed as Scroll mode (front) and DPI cycle (rear). The 2026-10-07 capture records successful direct-layer writes and exact restoration on both sources despite the reference app retaining a read-only UI flag. Neuron uses its existing preflight, backup, verified write and rollback path; physical acceptance on the reported Windows dock remains pending. V3's extra index, pinky, scroll and profile controls are exposed. Hypershift, Bluetooth configuration, onboard macro storage and DPI controls outside the modern Naga models listed below remain unavailable.

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

Neuron's new adapters have simulated transport tests for exact restoration, wrong model/plate rejection, lost acknowledgements, rollback, and automatic profile selection. They still need Windows hardware acceptance testing on each model/transport. An upstream hardware capture establishes protocol evidence; it does not mean Neuron has been physically tested on that device. Older Naga models now have explicitly best-guess adapters; their physical input behavior remains unverified.

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

## Trinity Save onboard

Save onboard uses the existing verified pending-2 / active-1 binding writes. It commits a per-device `onboard` snapshot in the durable original-settings backup only after every write passes readback. Original entries remain intact. A failed snapshot commit rolls back device writes and retains the previous saved snapshot. Profiles with assigned host macros are rejected before hardware mutation; unused library macros are allowed.

Automatic restoration, workspace changes, update installation, and quit use the saved snapshot when present. Sources first changed by later temporary profiles fall back to their original entries. Trinity restoration reads all affected entries and writes changed sources in pending-then-active order, skipping unchanged sources. Explicit Restore original restores the first original mappings and any backed-up DPI, then clears the onboard snapshot. Saving onboard leaves DPI unchanged and does not capture temporary assignments from another side plate.

Tests cover restart persistence, replacement, macro and model gating, multi-plate behavior, rollback after lost acknowledgement or disk failure, and original restoration. The Electron onboard smoke test exercises real IPC and quit cleanup with simulated binding I/O. Physical unplug/power-cycle persistence has not been verified; no extra firmware mode or profile-slot selection commands are sent.

## Current DPI

Modern Naga DPI coverage (all ranges begin at 100):

| Model | USB/receiver IDs | Maximum DPI | Scalar SET storage |
| --- | --- | --- | --- |
| Trinity | 0067 | 16,000 | 00 |
| Left-Handed Edition 2020 | 008D | 20,000 | 01 |
| Naga Pro | 008F / 0090 | 20,000 | 01 |
| Naga X | 0096 | 18,000 | 01 |
| V2 HyperSpeed | 00B4 | 30,000 | 01 |
| V2 Pro | 00A7 / 00A8; identified 00A4 dock | 30,000 | 00 |
| V3 Pro | 00E7 / 00E8; identified 00A4 dock | 50,000 | 00 |

All use transaction 1F, GET 04:85 with storage 00, and SET 04:05 with the model-specific storage above. Pro, X, and Left-Handed 2020 follow [OpenRazer's DPI transport](https://github.com/openrazer/openrazer/blob/master/driver/razermouse_driver.c) and [ranges](https://github.com/openrazer/openrazer/blob/master/daemon/openrazer_daemon/hardware/mouse.py); HyperSpeed follows [OpenNaga's documented scalar write](https://github.com/Zer0codestuff/OpenNaga/blob/main/Sources/NagaController/Hardware/RazerProtocol.swift). Stored scalar writes may persist on the mouse, but Neuron does not promise power-cycle persistence or modify the separate stage table. Backups and rollback cover current X/Y sensitivity; they do not snapshot other onboard banks.

Physical button layouts remain model-specific. The Left-Handed 2020 underside profile button is now listed as a hardware control, with remapping unavailable because its source is not established; its existence is documented in [Razer's guide](https://dl.razerzone.com/master-guides/RazerSynapse3/NAGALEFT-HANDEDEDITION-00000141-en.pdf). Existing index, DPI, wheel-tilt, pinky and scroll-button mappings retain their sources and gain restoration/rollback tests. Naga X does not gain wheel-tilt controls it does not have.

Naga V3 Pro (`00E7` / `00E8`) supports 100–50,000 DPI through the same current-sensitivity commands, including an identified V3 Pro through Mouse Dock Pro. V3 wired/receiver protocol evidence is published in [OpenSnek's V3 notes](https://github.com/gh123man/OpenSnek/blob/main/docs/protocol/USB_PROTOCOL.md#razer-naga-v3-pro-0x00e7-wired-0x00e8-receiver) and [wired write/readback/restore capture](https://github.com/gh123man/OpenSnek/blob/main/captures/usb/2026-10-18-naga-v3-pro-wired/README.md); the ceiling follows [Razer specifications](https://mysupport.razer.com/app/answers/detail/a_id/21025). V3 dock passthrough is an experimental extension of the existing paired-mouse transport, not a hardware-verified V3 capture. Tests exercise all three paths, including restoration of 50,000-DPI originals. Existing V3 body-button sources (index 11/12, pinky 57, scroll 106/128, profile 14) remain unchanged, with additional write/restore/rollback coverage.

Naga V2 Pro (`00A7` / `00A8`) and a Dock Pro (`00A4`) identified as V2 Pro now use the same current-sensitivity command shape, with a 100–30,000 DPI range. Neuron reads and writes live storage `00` on transaction `1F`, leaving stored stage tables alone. The backend checks both transport and paired model; a dock with an unknown or unsupported mouse cannot use this adapter. The native decoder rejects truncated DPI reports, and the DPI parser checks the storage echo and both axes against the model range. The UI enables Apply only after a successful read and clears the reading on read failure.

Sources: [OpenSnek current DPI protocol and Naga V2 Pro validation](https://github.com/gh123man/OpenSnek/blob/main/docs/protocol/USB_PROTOCOL.md), [OpenRazer per-model DPI reads](https://github.com/openrazer/openrazer/blob/master/driver/razermouse_driver.c), and [OpenMouse's V2 Pro / Dock Pro passthrough validation](https://github.com/OpenMouse-Project/mouse-protocol/blob/main/docs/razer-testing.md). Dock mouse passthrough uses transaction `1F`; this is separate from the dock's own accessory-lighting commands. Neuron's simulated tests cover each transport, independent X/Y values, range rejection, wrong/short replies, ignored writes, lost acknowledgements, rollback and explicit restoration above 16,000 DPI. Physical acceptance on the user's mouse and dock remains pending.

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

## Redragon M990-WL

The M990-WL has a separate experimental Compx driver. Its wireless receiver is
`3554:F55D`; the installed vendor configuration also lists wired `3554:F55E`.
These IDs are shared with other products. Neuron requires a successful live
`ReadCIDMID` response of CID 23 / MID 48, even after manual model selection and
again before each settings operation. An unresponsive or differently paired
receiver cannot enter the write path. Ambiguous multiple receivers with the same
USB identity remain read-only until their Windows interfaces can be associated.

The transport uses interface 1, usage page `FF02`, usage 2, output/input report
8 (17 bytes including the report ID). All frames sum to `55` modulo 256; replies
must match the command, address, status, and requested read length. The identity
query has no payload. A payload of `[1]`, used by some community implementations,
was rejected by this firmware and must not be treated as successful identification.

The 16 side buttons use four-byte assignments at `0060..009F` and corresponding
32-byte shortcut slots at `0100..02FF`. Keyboard combinations use class 5 and the
same-index shortcut slot. Neuron supports keyboard keys, modifier masks, its
F13–F24 macro triggers, disabled buttons, and the five standard mouse buttons.
Top buttons, lighting, firmware, and onboard macro storage are not written.
Battery command 4 returns percentage and charging status. Configuration writes
are persistent; automatic profile switching only writes changed records.

Before any write, Neuron saves the complete original assignment and shortcut
areas. Each write is read back, then the existing onboard configuration is
reloaded and the complete mapping snapshot is checked again. Failed operations
attempt restoration, including partially written shortcuts. Backups are retained
for Restore original. Switching the physical onboard profile requires returning
to the backed-up profile before applying or restoring.

### M990-WL active-stage DPI

The installed vendor configuration identifies PAW3395 with `DPIRange=50,26000,50,0x00`.
The adapter reads the checked stage selector at `0004` and its four-byte record
at `000C + stage * 4`. Each axis is encoded as DPI / 50 minus one: low bytes are
X/Y, and the extension byte holds X bits 8–9 in bits 2–3 and Y bits 8–9 in bits
6–7. The fourth byte makes the record sum to `55`. Unsupported multiplier bits,
bad checksums, out-of-range values and nonmultiples of 50 are rejected.
The earlier local flash capture contains `[52,52,0,237]` at `000C`, consistent
with 2,650 DPI on both axes. This is evidence for decoding, not physical write validation.

The implementation follows the published [Compx stage format](https://github.com/dongkid/g49-web-control/blob/da76cef7822741421a7612f1db4bbdb18d199dfd/js/protocol.js)
and [stage write/reload sequence](https://github.com/dongkid/g49-web-control/blob/da76cef7822741421a7612f1db4bbdb18d199dfd/js/mouse-api.js),
cross-checked against [independent-axis extension fields](https://github.com/E1yWrites/udb/blob/1afdd4581d603a3afaba2a3df4c0e92a3003fab0/src/adapters/compx-dpi.ts),
with M990-WL identity gating and the installed model's limits. Writes are limited
to one complete validated four-byte stage record, followed by reload of the
current onboard profile and exact readback. No stage selector, count, colors,
lighting, or polling-rate writes are enabled. Read and Apply retain profile/stage
context to reject stale UI readings after a hardware button changes either.

Version-2 Redragon backups retain the original mappings and additionally save
the first original raw record of each changed DPI stage in `dpi.stages`, scoped
to the original onboard profile. Failures restore the pre-operation record;
explicit Restore original restores all backed-up stages without selecting a
different stage. Button-profile operations and automatic restoration leave DPI
alone. Existing mapping-only backups remain compatible. Simulated transport
tests cover both USB identities, independent axes, boundaries, stale context,
bad records, lost acknowledgements, rollback, and recovery from corrupted stages.
The Electron smoke test covers range/step validation and unknown readings.
A read-only live probe on 2026-11-17 confirmed profile 1, zero-based stage 0,
and `[52,52,0,237]`: 2,650 DPI on both axes. The evidence is in local
`artifacts/redragon-dpi/live-read.json`. After waking the mouse, a wireless
roundtrip changed X to 2,700 while retaining Y at 2,650, verified the new raw
record after reload, then restored both axes to 2,650 and verified the exact
original record. The complete `0000..005F` settings area and mapping snapshot
matched their originals afterward; during the change only the active stage's
four bytes differed. Evidence is in `artifacts/redragon-dpi/roundtrip.json`.
This verifies device write/readback/restoration, not measured cursor travel,
power-cycle persistence, the full DPI range, or wired transport.
`node scripts/redragon-dpi-roundtrip.cjs` tests a temporary 50-DPI X-axis change
with a durable snapshot, exact restoration in `finally`, and checks that other
settings and mappings stay unchanged. Keep the mouse awake throughout the test.

Local hardware validation on 2026-11-17 confirmed CID 23 / MID 48, battery 100%,
the settings layout, and a temporary side-button-1 F24 mapping. The user pressed
and released that button; Windows observed both events. The test restored all
original bytes and verified the full snapshot. The remaining positions, mouse
actions, and modifier combinations still need individual physical acceptance
tests. Wired USB is based on the vendor configuration and remains untested.
`node scripts/redragon-roundtrip.cjs --listen` repeats the temporary one-button
test with automatic restoration; its recovery snapshot stays in `artifacts`.
`electron . --redragon-smoke-test` exercises selection, the 16-button editor,
saved profiles, and unsupported-device gating without hardware writes.

Protocol references: [Compx framing and identity](https://github.com/E1yWrites/udb/blob/1afdd4581d603a3afaba2a3df4c0e92a3003fab0/src/adapters/compx.ts),
[flash assignment records](https://github.com/dongkid/g49-web-control/blob/da76cef7822741421a7612f1db4bbdb18d199dfd/js/protocol.js),
and [shortcut context format](https://github.com/dongkid/g49-web-control/blob/da76cef7822741421a7612f1db4bbdb18d199dfd/js/mouse-api.js).
The installed M990-WL 1.0.2.0 `Config.ini` supplies CID 23, MID 48, `KeyNumber=16`,
PAW3395, and the transport IDs. No vendor binaries or configuration files are bundled.

## Razer references

- [OpenRazer device IDs](https://github.com/openrazer/openrazer/blob/master/driver/razermouse_driver.h).
- [Trinity capture notes](https://github.com/cepheiden/Razer-Naga-Trinity-MACOS/blob/main/CLAUDE.md), especially the Wireshark-decoded side-button section. Earlier statements in that file about unimplemented writes are superseded by its later capture notes.
- [Trinity source mapping reference](https://github.com/cepheiden/Razer-Naga-Trinity-MACOS/blob/main/electron/sideBindings.ts) and [transport reference](https://github.com/cepheiden/Razer-Naga-Trinity-MACOS/blob/main/electron/nagaDriver.ts).
- [Microsoft HidD_SetFeature](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/hidsdi/nf-hidsdi-hidd_setfeature) and [SendInput](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput).
