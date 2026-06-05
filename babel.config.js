// Rewrites every `import.meta` reference to a static production object.
// Some deps (e.g. zustand's devtools middleware) ship `import.meta.env.MODE`.
// Expo's web export emits a CLASSIC <script> bundle, and `import.meta` in a
// classic script is a parse-time SyntaxError that aborts the ENTIRE bundle —
// the app renders blank with no console output. Replacing it with
// `{ env: { MODE: 'production' } }` keeps those guards working and parses fine.
function stripImportMeta() {
  return {
    name: "strip-import-meta",
    visitor: {
      MetaProperty(path) {
        if (path.node.meta && path.node.meta.name === "import") {
          path.replaceWithSourceString("({ env: { MODE: 'production' } })");
        }
      },
    },
  };
}

module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ["babel-preset-expo", { jsxImportSource: "nativewind" }],
      "nativewind/babel"
    ],
    plugins: [stripImportMeta],
  };
};
