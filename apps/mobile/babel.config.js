module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // babel-preset-expo (SDK 51) doesn't yet transform "static class blocks"
    // (a fairly recent JS syntax feature) -- @formatjs/intl-pluralrules'
    // polyfill (src/i18n/index.ts) uses that syntax, which otherwise fails
    // to bundle on Hermes with "Static class blocks are not enabled."
    //
    // 'react-native-reanimated/plugin' MUST be the LAST entry in this array
    // (Reanimated's own documented requirement -- it rewrites worklets after
    // every other transform has run).
    plugins: ['@babel/plugin-transform-class-static-block', 'react-native-reanimated/plugin'],
  };
};
