/**
 * Both on-device models in one module, so the worker bundle stays one chunk holding transformers.js, the ONNX runtime
 * and the text detector (the detector adds a few KB to it).
 */
export { useLocalFilesOnly, loadNerScorer } from './ner-model';
export { loadTextDetector } from './text-detector';
export { loadTextReader } from './text-reader';
