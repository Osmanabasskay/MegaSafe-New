const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// Stop Metro's file watcher from descending into directories that hold
// transient files (e.g. TestSprite's `testsprite_tests/tmp/mcp.log.lock`).
// On Windows there is no Watchman, so Metro uses the FallbackWatcher, which
// fs.watch()'s every file it crawls. Short-lived lock files vanish before the
// watch is established, throwing an uncaught ENOENT that kills the dev server
// and causes TestSprite runs to report "Blocked". These patterns are matched
// against both forward- and back-slash paths, so they work cross-platform.
const watchExclusions = [
  /[\\/]testsprite_tests([\\/].*)?$/,
  /[\\/]\.testsprite([\\/].*)?$/,
];

const existingBlockList = config.resolver.blockList;
config.resolver.blockList = Array.isArray(existingBlockList)
  ? [...existingBlockList, ...watchExclusions]
  : existingBlockList
    ? [existingBlockList, ...watchExclusions]
    : watchExclusions;

const withVectorIconsCompat = (cfg) => {
  cfg.transformer = {
    ...cfg.transformer,
    // @expo/vector-icons v15+ and zustand ship ESM builds — Babel must
    // transpile them so the strip-import-meta plugin can rewrite zustand's
    // `import.meta` (otherwise it leaks into the classic-script web bundle).
    transformIgnorePatterns: [
      'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/(?!haptics)|@expo-google-fonts|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|react-native-reanimated|zustand)',
    ],
  };
  return cfg;
};

module.exports = withVectorIconsCompat(
  withNativeWind(config, { input: "./app/global.css" })
);
