const path = require('path');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

// Vendored UI libraries (MIT, Jakub Antalik). Neither native port is
// published to npm, so they live in ./vendor and are consumed from source
// here rather than from a dist build.
//
//   bot-avatars          -> the web package (pure rig + geometry; the native
//                           port imports its engine, presets and plastic bakes)
//   bot-avatars-native   -> <BotAvatar type="ghost" />
//   thinking-orbs-native -> <ThinkingOrb state="composing" />
//
// `thinking-orbs` itself is a normal npm dependency (its compiled engine is
// what the orb port draws), so it is not aliased here.
const VENDOR = path.resolve(__dirname, 'vendor');

const VENDOR_MODULES = {
  'bot-avatars': path.join(VENDOR, 'bot-avatars', 'src', 'rig.ts'),
  'bot-avatars-native': path.join(VENDOR, 'bot-avatars-native', 'src'),
  'thinking-orbs-native': path.join(VENDOR, 'thinking-orbs-native', 'src'),
};

const defaultConfig = getDefaultConfig(__dirname);
const {assetExts, sourceExts} = defaultConfig.resolver;

const config = {
  // Metro must watch the vendored packages to resolve and hot-reload them.
  watchFolders: [VENDOR],
  resolver: {
    assetExts: assetExts.filter(ext => ext !== 'svg'),
    sourceExts: [...sourceExts, 'svg'],
    extraNodeModules: {
      ...VENDOR_MODULES,
    },
  },
  transformer: {
    babelTransformerPath: require.resolve(
      'react-native-svg-transformer/react-native',
    ),
    getTransformOptions: async () => ({
      transform: {
        experimentalImportSupport: false,
        inlineRequires: true,
      },
    }),
    // Make sure decorators are properly transformed
    enableBabelRuntime: true,
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
