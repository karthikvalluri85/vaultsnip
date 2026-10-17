// Vite plugin: writes Unicode noncharacters (U+FFFE, U+FFFF, U+FDD0–U+FDEF) in generated JS as \uXXXX escapes.
// Chrome refuses to inject a content script that contains them ("It isn't UTF-8 encoded"), and some
// bundled libraries compare against a literal U+FFFE. They only occur inside string literals, where the escape means the same.
export const escapeNonchars = () => ({
  name: 'vaultsnip-escape-nonchars',
  generateBundle(_opts, bundle) {
    for (const f of Object.values(bundle)) {
      if (f.type === 'chunk') f.code = f.code.replace(/[﷐-﷯￾￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
    }
  },
});
