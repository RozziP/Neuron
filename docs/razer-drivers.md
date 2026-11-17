# Razer mouse layouts and experimental drivers

Neuron v0.1.6 contains 131 Razer mouse connection identities:
123 USB/wired/receiver candidates and eight Bluetooth identities for offline
profile editing. Connection identities are not 131 distinct mouse models.
These experimental adapters are included in the v0.1.6 installer.

The catalog covers the mouse entries researched from OpenRazer/OpenSynapse,
plus newer OpenRazer/OpenSnek identities. Shared accessories are not mouse
models: the HyperPolling dongle `1532:00B3` is excluded from the mouse catalog
and does not yet have a remapping transport. Mouse Dock Pro `1532:00A4`
retains separate paired-model identification and limited passthrough support.

## What the confidence labels mean

- **Locally tested:** Trinity retains its existing Neuron hardware evidence.
  This does not certify every control or every side plate. See
  [the hardware notes](hardware.md) for the actual acceptance tests.
- **Community protocol:** model-specific button/protocol evidence exists in
  another project. Neuron has not physically validated these new adapters.
- **Best guess:** the device identity is documented, but its button sources,
  request size, transaction identifier or storage slots are inferred from
  related Razer models. The adapter may fail to read or apply on real hardware.

Upstream device support often means DPI, battery or lighting support, not
button remapping. A successful unit test or write/readback also does not prove
that the intended physical button generates the intended input. Each model
still needs physical press/release and exact-restore validation. Best-guess
models remain eligible for unsupported-hardware reports and do not automatically
close those issues merely because a candidate driver exists.

## Every model has its own control layout

`app/razer-devices.json` holds the identities; `app/razer-layouts.cjs` explicitly
assigns every identity a physical layout and candidate source map. The catalog,
editor, inspection and hardware writes use the same layout. Missing layouts
fail at startup rather than silently inheriting a twelve-button Naga grid.

All layouts include left click, right click, wheel click and both wheel-scroll
directions. Scroll directions are input actions, not additional physical
switches. Other body controls are included only in their assigned model layout.

| Family or example | Side layout | Additional controls and distinctions |
| --- | --- | --- |
| Abyssus family | None | V2 has a DPI-cycle button; original 1800 underside switch is shown as fixed |
| DeathAdder, Cobra, Atheris, most modern Vipers | Two | Model-specific DPI button/pair and profile button where applicable |
| Orochi 2011/2013, Diamondback, Taipan, Lancehead, original Viper/Ultimate/8KHz | Four | Both left and right side buttons; model-specific DPI controls |
| Ouroboros | Four | DPI pair and both grip triggers |
| Original Naga, Naga 2012 | Twelve | DPI pair, no wheel tilt |
| Naga Hex / Hex V2 | Six / seven | Separate ring source range; Hex V2 adds wheel tilt |
| Naga X | Twelve | DPI cycle, no wheel tilt |
| Naga Trinity | Two, seven, twelve | Wheel tilt and DPI pair |
| Naga Pro | Two, six, twelve | Wheel tilt, DPI pair and underside profile |
| Naga V2 Pro | Two, six, twelve | Wheel tilt and profile; both wheel-stage buttons shown as fixed |
| Naga V2 HyperSpeed | Twelve | Wheel tilt and both index buttons |
| Naga V3 Pro | Two, six, twelve | Wheel tilt, both index buttons, pinky, front/rear scroll buttons and profile |
| Basilisk / Essential / V2 / Ultimate | Two | Model-specific clutch, DPI, tilt and profile controls |
| Basilisk V3 / Pro / 35K variants | Two | Tilt, DPI cycle, clutch; wheel-mode and underside profile kept fixed |
| Basilisk V3 X | Two | DPI cycle; thumb/Hypershift control kept fixed |
| Basilisk V4 | Two | Tilt, thumb paddle, extra front side button and profile |
| Pro Click / Mini / V2 | Two | Model-specific tilt and DPI; mechanical/firmware wheel-mode controls shown as fixed |
| Pro Click V2 Vertical / Basilisk Mobile | Two | Shortcut button; Mobile adds tilt; connection controls kept fixed |

Pro Click V2's AI shortcut is a long press of wheel click, not a fictitious
extra physical button. Selecting it here remaps wheel click; Neuron does not
implement Synapse's AI integration. Model-specific fixed controls stay visible
but cannot receive assignments. Fixed here can mean hardware-operated or that
reliable remapping is unavailable, not necessarily permanently nonprogrammable.

Two-button sides use sources 5/4; ambidextrous four-button sides add 7/6.
Twelve-button panels use 64–75; six/seven-button rings use 80 onward.
These family estimates remain speculative where no model-specific capture
exists. Body source maps and fixed-source exclusions are listed directly in
`app/razer-layouts.cjs`.

## Apply, inspection and recovery

New non-Naga Razer profiles start with Original for every control. Existing
Naga key defaults remain compatible. Original preserves untouched controls or
restores the saved pre-Neuron assignment after a change. Inspection reads all
editable body and side controls, shows unavailable reads individually, and
does not query fixed controls as remappable inputs.

Apply reads every assignment it intends to change before its first write,
saves originals, writes and verifies readback. A failed preflight read stops
the apply without writing. Restore preserves all seven original function bytes,
including native keyboard blocks whose declared parameter length omits the
stored key. Missing/fixed control assignments are rejected; the editor can
reset stale assignments to Original. Only real editable controls count toward
the required Left click assignment.

Most candidates use live slot 0 and ten-byte button requests. Trinity retains
slots 2/1; V2 HyperSpeed and Viper Ultimate use stored/live slots 1/0. DeathAdder
V4 Pro uses the capture-backed 80-byte request size. Basilisk V3 X supports
the older reply layout without the layer byte as well as the echoed-layer
layout. Other candidates use the existing extended layout; firmware differences
may require a model-specific decoder. No runtime guessing of arbitrary source
IDs or write-based discovery is performed.

Dock Pro accepts selected Naga V2/V3 Pro, Basilisk V3 Pro/35K and Cobra Pro
identities, using a read-only pairing query when available or the saved user
choice. Accessory passthrough remains experimental. Choosing another model
does not enable an arbitrary transport. Bluetooth configuration, Hypershift
layers, raw input streaming and onboarding every shared dongle are outside
this expansion. DPI support remains Trinity-only; battery support is separate.
New wireless identities without a battery adapter report unavailable.

## Validation

`node --test test/*.test.cjs` covers complete/unique source maps for every
candidate panel, fixed/missing controls, primary-click protection, preflight
failure before writes, full-byte restoration, Original on side buttons,
request-size differences, partial inspection failures and reporting behavior.

Run `node_modules/electron/dist/electron.exe scripts/razer-layout-smoke.cjs`
for the isolated offline UI check. It exercises every Razer identity and
physical panel at two window sizes (302 cases), checking displayed controls,
labels, selection, panel choices, overlap and horizontal overflow. Results and
screenshots are written under `artifacts/razer-layout-smoke`. It never opens
a hardware connection or modifies normal user settings.

## Sources

Research snapshot: 2026-11-17. These are protocol facts and independently
expressed model layouts; upstream application code is not bundled.

- [OpenRazer mouse USB identities](https://github.com/openrazer/openrazer/blob/master/driver/razermouse_driver.h).
- [OpenSynapse generated device catalog](https://github.com/JohnsonRan/OpenSynapse/blob/master/internal/razer/data/devices.json)
  and [button protocol](https://github.com/JohnsonRan/OpenSynapse/blob/master/internal/razer/buttons.go):
  device metadata and DeathAdder V4 Pro request framing.
- [OpenSnek USB protocol notes](https://github.com/gh123man/OpenSnek/blob/main/docs/protocol/USB_PROTOCOL.md),
  [device support](https://github.com/gh123man/OpenSnek/blob/main/OpenSnek/Sources/OpenSnekCore/DeviceSupport.swift),
  and [binding format notes](https://github.com/gh123man/OpenSnek/blob/main/OpenSnek/Sources/OpenSnekCore/ButtonBindingSupport.swift):
  modern Naga/Basilisk sources, fixed-control restrictions and reply variants.
- [razer-control button protocol](https://github.com/voidrlm/razer-control/blob/main/razer_control/buttons.py):
  Viper Ultimate stored/live slots and general source identifiers.
- [OpenNaga onboard binding notes](https://github.com/Zer0codestuff/OpenNaga/blob/main/Sources/NagaController/Hardware/RazerOnboardBindings.swift):
  V2 HyperSpeed storage and restoration.
- Manufacturer layout checks: [Pro Click V2 guide](https://dl.razerzone.com/master-guides/RazerSynapse4/PROCLICKV2-00000208-en.pdf),
  [Abyssus V2 guide](https://dl.razerzone.com/master-guides/RazerSynapse/AbyssusV2-00000091-en.pdf),
  [Basilisk Essential guide](https://dl.razerzone.com/master-guides/RazerSynapse3/BASILISKESSENTIAL-00000101-en.pdf),
  and [Basilisk Mobile specifications](https://www.razer.com/eu-en/gaming-mice/razer-basilisk-mobile).

See [third-party references](../THIRD_PARTY.md) and [hardware notes](hardware.md)
for the original Trinity, dock and licensing references.
