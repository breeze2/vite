export const env = {
  //
}

export const nextTick = (func, ...args) => setTimeout(() => func(...args))

globalThis.processBrowserify = {
  env
}
