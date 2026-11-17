# Third-party dependencies and protocol references

Neuron's application code and interface were authored in this project. Protocol facts and USB identifiers were researched from the following independent projects:

- OpenRazer: https://github.com/openrazer/openrazer — Naga product IDs and Razer feature-report framing. OpenRazer is GPL-2.0-or-later.
- cepheiden/Razer-Naga-Trinity-MACOS: https://github.com/cepheiden/Razer-Naga-Trinity-MACOS — published Trinity capture notes, side-button source IDs, action format, and pending/active slot behavior. No bundled copy of that application is used.
- GavinViney/openrazer-win: https://github.com/GavinViney/openrazer-win — secondary reference for the report layout; not included as a dependency. Its Basilisk-specific behavior was not treated as verified Naga behavior.

Runtime dependencies:

- Electron, MIT: https://github.com/electron/electron. Its distribution includes Chromium and other components; the portable folder includes Electron's `LICENSE` and `LICENSES.chromium.html`.
- node-hid, MIT: https://github.com/node-hid/node-hid, including its native HIDAPI dependency and license files.

Development packaging uses @electron/packager (BSD-2-Clause). Dependency license files remain in the installed packages. The lockfile records exact resolved dependency versions.

Razer, Naga, and Synapse are trademarks of their respective owners. Neuron is an independent project.
