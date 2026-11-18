// Explicit Babel config.
//
// Until now this file did not exist and @expo/metro-config fell back to
// `babel-preset-expo` implicitly. That worked, but it left nowhere to add a
// plugin — and `jest-expo` (component tests) requires a real config file.
//
// Reanimated (the Edit profile header, 2026-11-16) needs its worklets plugin:
// as of react-native-reanimated v4 it lives in react-native-worklets and must
// be LAST in `plugins`. It turns functions marked 'worklet' into code that runs
// on the UI thread (src/features/profile/heroState.ts).
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: ['react-native-worklets/plugin'],
  };
};
