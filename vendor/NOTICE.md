# Vendored UI libraries — third-party notices

The packages under `vendor/` are not written by this project. They are copied
verbatim from the upstream repositories below and consumed from source (Metro
`watchFolders` + `extraNodeModules`, see `metro.config.js`).

All three are **MIT licensed**. The full upstream license text is kept next to
each package (`vendor/LICENSE`, `vendor/bot-avatars/LICENSE`,
`vendor/thinking-orbs-native/LICENSE`).

| Local path | Upstream | Version | Author | License |
| --- | --- | --- | --- | --- |
| `vendor/bot-avatars` | [`packages/bot-avatars`](https://github.com/Jakubantalik/Libraries/tree/main/packages/bot-avatars) in `Jakubantalik/Libraries` | 0.2.2 | Jakub Antalik | MIT |
| `vendor/bot-avatars-native` | [`packages/bot-avatars/ports/react-native/bot-avatars-native`](https://github.com/Jakubantalik/Libraries/tree/main/packages/bot-avatars/ports/react-native/bot-avatars-native) | 0.1.0 | Jakub Antalik | MIT |
| `vendor/thinking-orbs-native` | [`packages/thinking-orbs/ports/react-native/thinking-orbs-native`](https://github.com/Jakubantalik/Libraries/tree/main/packages/thinking-orbs/ports/react-native/thinking-orbs-native) | 0.1.0 | Jakub Antalik | MIT |

## Why vendored and not installed

`bot-avatars-native` and `thinking-orbs-native` are **not published to npm** —
they exist only as ports inside the upstream monorepo. They are copied here
because the app needs them at build time and there is no registry entry to
depend on.

`bot-avatars` (the web package) *is* published, but the native port imports its
rig, presets and plastic-bake maths directly from source, so the source copy is
what the port is compiled against. Keeping it vendored keeps the port and the
rig on the same commit.

`thinking-orbs` (the web package, whose compiled `engine` the orb port draws
from) **is** a normal npm dependency in `package.json` — it is not vendored.

## Local modifications

Only one change was made to a vendored file: `vendor/bot-avatars-native/package.json`
had its `bot-avatars` dependency rewritten from `file:../../..` (the upstream
monorepo layout) to `file:../bot-avatars` (this repo's `vendor/` layout). No
source file was modified.

## Peer dependencies

| Package | Peer | This app |
| --- | --- | --- |
| `bot-avatars-native` | `@shopify/react-native-skia >= 2.0.0` | 2.14.0 |
| | `react-native-reanimated >= 4.0.0` | 4.7.1 |
| | `react-native-worklets >= 0.7.0` | 0.13.0 |
| | `react-native >= 0.78.0` | 0.87.1 |
| `thinking-orbs-native` | `@shopify/react-native-skia >= 1.0.0` | 2.14.0 |
| | `react-native-reanimated >= 3.0.0` | 4.7.1 |

`@shopify/react-native-skia` was added by this project; it was not a dependency
before.
