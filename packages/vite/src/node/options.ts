import path from 'node:path'
import colors from 'picocolors'
import type { BuildOptions, ResolvedBuildOptions } from './build'
import type { Logger } from './logger'
import type { ResolvedServerOptions, ServerOptions } from './server'
import type { PreviewOptions, ResolvedPreviewOptions } from './preview'
import {
  mergeConfig,
  normalizePath,
  searchForWorkspaceRoot
} from './publicUtils'
import { CLIENT_DIR, ESBUILD_MODULES_TARGET } from './constants'
import { isParentDirectory } from './utils'

export function resolveBuildOptions(
  raw: BuildOptions | undefined,
  logger: Logger
): ResolvedBuildOptions {
  const deprecatedPolyfillModulePreload = raw?.polyfillModulePreload
  if (raw) {
    const { polyfillModulePreload, ...rest } = raw
    raw = rest
    if (deprecatedPolyfillModulePreload !== undefined) {
      logger.warn(
        'polyfillModulePreload is deprecated. Use modulePreload.polyfill instead.'
      )
    }
    if (
      deprecatedPolyfillModulePreload === false &&
      raw.modulePreload === undefined
    ) {
      raw.modulePreload = { polyfill: false }
    }
  }

  const modulePreload = raw?.modulePreload
  const defaultModulePreload = {
    polyfill: true
  }

  const defaultBuildOptions: BuildOptions = {
    outDir: 'dist',
    assetsDir: 'assets',
    assetsInlineLimit: 4096,
    cssCodeSplit: !raw?.lib,
    sourcemap: false,
    rollupOptions: {},
    minify: raw?.ssr ? false : 'esbuild',
    terserOptions: {},
    write: true,
    emptyOutDir: null,
    copyPublicDir: true,
    manifest: false,
    lib: false,
    ssr: false,
    ssrManifest: false,
    reportCompressedSize: true,
    chunkSizeWarningLimit: 500,
    watch: null
  }

  const userBuildOptions = raw
    ? mergeConfig(defaultBuildOptions, raw)
    : defaultBuildOptions

  // @ts-expect-error Fallback options instead of merging
  const resolved: ResolvedBuildOptions = {
    target: 'modules',
    cssTarget: false,
    ...userBuildOptions,
    commonjsOptions: {
      include: [/node_modules/],
      extensions: ['.js', '.cjs'],
      ...userBuildOptions.commonjsOptions
    },
    dynamicImportVarsOptions: {
      warnOnError: true,
      exclude: [/node_modules/],
      ...userBuildOptions.dynamicImportVarsOptions
    },
    // Resolve to false | object
    modulePreload:
      modulePreload === false
        ? false
        : typeof modulePreload === 'object'
        ? {
            ...defaultModulePreload,
            ...modulePreload
          }
        : defaultModulePreload
  }

  // handle special build targets
  if (resolved.target === 'modules') {
    resolved.target = ESBUILD_MODULES_TARGET
  } else if (resolved.target === 'esnext' && resolved.minify === 'terser') {
    // esnext + terser: limit to es2021 so it can be minified by terser
    resolved.target = 'es2021'
  }

  if (!resolved.cssTarget) {
    resolved.cssTarget = resolved.target
  }

  // normalize false string into actual false
  if ((resolved.minify as any) === 'false') {
    resolved.minify = false
  }

  if (resolved.minify === true) {
    resolved.minify = 'esbuild'
  }

  return resolved
}

export function resolvePreviewOptions(
  preview: PreviewOptions | undefined,
  server: ResolvedServerOptions
): ResolvedPreviewOptions {
  // The preview server inherits every CommonServerOption from the `server` config
  // except for the port to enable having both the dev and preview servers running
  // at the same time without extra configuration
  return {
    port: preview?.port,
    strictPort: preview?.strictPort ?? server.strictPort,
    host: preview?.host ?? server.host,
    https: preview?.https ?? server.https,
    open: preview?.open ?? server.open,
    proxy: preview?.proxy ?? server.proxy,
    cors: preview?.cors ?? server.cors,
    headers: preview?.headers ?? server.headers
  }
}

function resolvedAllowDir(root: string, dir: string): string {
  return normalizePath(path.resolve(root, dir))
}

export function resolveServerOptions(
  root: string,
  raw: ServerOptions | undefined,
  logger: Logger
): ResolvedServerOptions {
  const server: ResolvedServerOptions = {
    preTransformRequests: true,
    ...(raw as ResolvedServerOptions),
    middlewareMode: !!raw?.middlewareMode
  }
  let allowDirs = server.fs?.allow
  const deny = server.fs?.deny || ['.env', '.env.*', '*.{crt,pem}']

  if (!allowDirs) {
    allowDirs = [searchForWorkspaceRoot(root)]
  }

  allowDirs = allowDirs.map((i) => resolvedAllowDir(root, i))

  // only push client dir when vite itself is outside-of-root
  const resolvedClientDir = resolvedAllowDir(root, CLIENT_DIR)
  if (!allowDirs.some((dir) => isParentDirectory(dir, resolvedClientDir))) {
    allowDirs.push(resolvedClientDir)
  }

  server.fs = {
    strict: server.fs?.strict ?? true,
    allow: allowDirs,
    deny
  }

  if (server.origin?.endsWith('/')) {
    server.origin = server.origin.slice(0, -1)
    logger.warn(
      colors.yellow(
        `${colors.bold('(!)')} server.origin should not end with "/". Using "${
          server.origin
        }" instead.`
      )
    )
  }

  return server
}
