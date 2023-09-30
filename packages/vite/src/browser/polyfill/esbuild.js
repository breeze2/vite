import * as esbuild from 'esbuild-wasm'

const version = '0.19.4'

let initializePromise

function initialize() {
  if (!initializePromise) {
    initializePromise = esbuild.initialize({
      worker: typeof Worker != 'undefined',
      wasmURL: 'https://www.unpkg.com/esbuild-wasm@0.14.47/esbuild.wasm' // todo: version
    })
  }
  return initializePromise
}

function context(e) {
  return initialize().then(() => esbuild.context(e))
}

function build(e) {
  return initialize().then(() => esbuild.build(e))
}

function transform(e, r) {
  return initialize().then(() => esbuild.transform(e, r))
}

function formatMessages(e, r) {
  return initialize().then(() => esbuild.formatMessages(e, r))
}

function startService() {
  return initialize().then(() => ({
    transform: esbuild.transform,
    build: esbuild.build
  }))
}

const _default = {
  context
}

export default _default

export { build, transform, formatMessages, startService, version }
