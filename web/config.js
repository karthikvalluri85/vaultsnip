/* VaultSnip runtime config. The extension build overwrites this file. */
window.VAULTSNIP_CONFIG = {
  // Where the OCR language model is fetched from on first launch. It is then cached in IndexedDB.
  langPath: 'lang',
  // Where the on-device name check's model is (folder holding pii-bert-small/); its weights are gzipped.
  mlModels: 'models/'
};
