# Third-party dependencies and protocol references

Neuron's application code and interface were authored in this project. Protocol facts and USB identifiers were researched from the following independent projects:

- OpenRazer: https://github.com/openrazer/openrazer — mouse product IDs and Razer feature-report framing. OpenRazer is GPL-2.0-or-later.
- cepheiden/Razer-Naga-Trinity-MACOS: https://github.com/cepheiden/Razer-Naga-Trinity-MACOS — published Trinity capture notes, side-button source IDs, action format, and pending/active slot behavior. No bundled copy of that application is used.
- GavinViney/openrazer-win: https://github.com/GavinViney/openrazer-win — secondary reference for the report layout; not included as a dependency. Its Basilisk-specific behavior was not treated as verified Naga behavior.

Additional protocol references for the experimental Pro-family and HyperSpeed adapters (protocol facts restated independently; no application source is bundled):

- OpenSnek, Apache-2.0: https://github.com/gh123man/OpenSnek — Naga Pro/V2 Pro/V3 Pro USB captures, button IDs, live profile storage, full function-block preservation.
- OpenNaga, MIT: https://github.com/Zer0codestuff/OpenNaga — V2 HyperSpeed stored/live binding behavior and restoration requirements.
- Secretarybird, MIT or Apache-2.0: https://github.com/infinityInfinite/secbird — Mouse Dock Pro passthrough, paired-device query, and live button writes.
- OpenMouse protocol: https://github.com/OpenMouse-Project/mouse-protocol — V2 Pro settings passthrough through Mouse Dock Pro.

Additional catalog and best-guess adapter research:

- [OpenSynapse device metadata](https://github.com/JohnsonRan/OpenSynapse/blob/master/internal/razer/data/devices.json), generated from OpenRazer, and its [button protocol notes](https://github.com/JohnsonRan/OpenSynapse/blob/master/internal/razer/buttons.go): factual mouse identities and DeathAdder V4 Pro request size. No application code is bundled.
- [razer-control button protocol](https://github.com/voidrlm/razer-control/blob/main/razer_control/buttons.py): Viper Ultimate storage slots and physical source identifiers. No application code is bundled.
- Razer product manuals and specifications: physical control layouts, including the distinction between wheel long-press actions and separate buttons. Manufacturer images, software and manuals are not bundled.

See [hardware notes](docs/hardware.md) and [Razer driver coverage](docs/razer-drivers.md) for source links and the distinction between upstream captures, family estimates and Neuron's own validation.

Redragon M990-WL protocol references (independent implementation of framing and
record formats, checked against the local mouse):

- [E1yWrites/udb Compx adapter](https://github.com/E1yWrites/udb/blob/1afdd4581d603a3afaba2a3df4c0e92a3003fab0/src/adapters/compx.ts): checksums, command matching, live CID/MID, and battery fields.
- [dongkid/g49-web-control](https://github.com/dongkid/g49-web-control), derived from vzpyr/m916proui: Compx flash addresses, assignment classes, and shortcut press/release contexts. No upstream application source or firmware is bundled.
- Installed Redragon M990-WL 1.0.2.0 configuration: model identity, sensor, USB IDs, and button count. No proprietary binaries or resources are distributed with Neuron.

Runtime dependencies:

- Electron, MIT: https://github.com/electron/electron. Its distribution includes Chromium and other components; the portable folder includes Electron's `LICENSE` and `LICENSES.chromium.html`.
- node-hid, MIT: https://github.com/node-hid/node-hid, including its native HIDAPI dependency and license files.

Development packaging uses @electron/packager (BSD-2-Clause) and electron-builder (MIT), with NSIS for the Windows installer. Dependency license files remain in the installed packages. The lockfile records exact resolved dependency versions.

Razer, Naga, and Synapse are trademarks of their respective owners. Neuron is an independent project.
