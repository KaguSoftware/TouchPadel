// Explicit Babel config.
//
// Until now this file did not exist and @expo/metro-config fell back to
// `babel-preset-expo` implicitly. That worked, but it left nowhere to add a
// plugin — and `jest-expo` (component tests) requires a real config file.
//
// If react-native-reanimated is ever added, its worklets plugin moved OUT of
// reanimated into react-native-worklets as of v4 and must be LAST:
//   plugins: ['react-native-worklets/plugin']
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
