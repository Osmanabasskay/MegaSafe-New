const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

const withVectorIconsCompat = (cfg) => {
  cfg.transformer = {
    ...cfg.transformer,
    // @expo/vector-icons v15+ ships ESM builds — Babel must transpile them
    transformIgnorePatterns: [
      'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/(?!haptics)|@expo-google-fonts|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg|react-native-reanimated)',
    ],
  };
  return cfg;
};

module.exports = withVectorIconsCompat(
  withNativeWind(config, { input: "./app/global.css" })
);
