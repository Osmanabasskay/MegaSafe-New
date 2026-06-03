const fs = require('fs');
const path = require('path');

const files = [
  path.join(__dirname, '..', 'node_modules', 'expo', 'src', 'launch', 'withDevTools.tsx'),
  path.join(__dirname, '..', 'node_modules', 'expo', 'src', 'launch', 'withDevTools.ios.tsx'),
];

const original = `const useOptionalKeepAwake: (tag?: string) => void = (() => {
    try {
      // Optionally import expo-keep-awake
      const { useKeepAwake, ExpoKeepAwakeTag } = require('expo-keep-awake');
      return () => useKeepAwake(ExpoKeepAwakeTag, { suppressDeactivateWarnings: true });
    } catch {}
    return () => {};
  })();`;

const patched = `const useOptionalKeepAwake: (tag?: string) => void = () => {};`;

for (const file of files) {
  if (!fs.existsSync(file)) continue;
  const source = fs.readFileSync(file, 'utf8');
  if (source.includes(patched)) continue;
  if (!source.includes(original)) {
    console.warn(`[patch-expo-keep-awake] Pattern not found in ${file}`);
    continue;
  }
  fs.writeFileSync(file, source.replace(original, patched));
  console.log(`[patch-expo-keep-awake] Patched ${file}`);
}
