import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { performance } from 'node:perf_hooks'
import { createRequire } from 'node:module'
import colors from 'picocolors'
import aliasPlugin from '@rollup/plugin-alias'
import { build } from 'esbuild'
import type { Plugin } from '../node/plugin'
import { resolveBuildOptions } from '../node/build'
import { resolveServerOptions } from '../node/server'
import {
  // type CSSOptions,
  // type ResolvedCSSOptions,
  resolveCSSOptions,
} from '../node/plugins/css'
import {
  asyncFlatten,
  createDebugger,
  createFilter,
  dynamicImport,
  isBuiltin,
  isExternalUrl,
  isNodeBuiltin,
  isObject,
  lookupFile,
  mergeAlias,
  mergeConfig,
  normalizeAlias,
  normalizePath,
  withTrailingSlash,
} from '../node/utils'
import {
  createPluginHookUtils,
  getSortedPluginsByHook,
  resolvePlugins,
} from '../node/plugins'
import {
  CLIENT_ENTRY,
  DEFAULT_ASSETS_RE,
  DEFAULT_CONFIG_FILES,
  DEFAULT_EXTENSIONS,
  DEFAULT_MAIN_FIELDS,
  ENV_ENTRY,
  FS_PREFIX,
} from '../node/constants'
import { resolvePlugin, tryNodeResolve } from '../node/plugins/resolve'
import type { LogLevel, Logger } from '../node/logger'
import { createLogger } from '../node/logger'
import type { DepOptimizationConfig } from '../node/optimizer'
import type { PluginContainer } from '../node/server/pluginContainer'
import { createPluginContainer } from '../node/server/pluginContainer'
import type { PackageCache } from '../node/packages'
import { findNearestPackageData } from '../node/packages'
import { loadEnv, resolveEnvPrefix } from '../node/env'
import { resolveSSROptions } from '../node/ssr'
import type {
  ConfigEnv,
  InlineConfig,
  ResolveWorkerOptions,
  ResolvedConfig,
  UserConfig,
  UserConfigExport,
} from '../node/config'

const debug = createDebugger('vite:config')
const promisifiedRealpath = promisify(fs.realpath)

export async function resolveConfig(
  inlineConfig: InlineConfig,
  command: 'build' | 'serve',
  defaultMode = 'development',
  defaultNodeEnv = 'development',
): Promise<ResolvedConfig> {
  let config = inlineConfig
  let configFileDependencies: string[] = []
  let mode = inlineConfig.mode || defaultMode
  const isNodeEnvSet = !!process.env.NODE_ENV
  const packageCache: PackageCache = new Map()

  // some dependencies e.g. @vue/compiler-* relies on NODE_ENV for getting
  // production-specific behavior, so set it early on
  if (!isNodeEnvSet) {
    process.env.NODE_ENV = defaultNodeEnv
  }

  const configEnv = {
    mode,
    command,
    ssrBuild: !!config.build?.ssr,
  }

  let { configFile } = config
  if (configFile !== false) {
    const loadResult = await loadConfigFromFile(
      configEnv,
      configFile,
      config.root,
      config.logLevel,
    )
    if (loadResult) {
      config = mergeConfig(loadResult.config, config)
      configFile = loadResult.path
      configFileDependencies = loadResult.dependencies
    }
  }

  // user config may provide an alternative mode. But --mode has a higher priority
  mode = inlineConfig.mode || config.mode || mode
  configEnv.mode = mode

  const filterPlugin = (p: Plugin) => {
    if (!p) {
      return false
    } else if (!p.apply) {
      return true
    } else if (typeof p.apply === 'function') {
      return p.apply({ ...config, mode }, configEnv)
    } else {
      return p.apply === command
    }
  }
  // Some plugins that aren't intended to work in the bundling of workers (doing post-processing at build time for example).
  // And Plugins may also have cached that could be corrupted by being used in these extra rollup calls.
  // So we need to separate the worker plugin from the plugin that vite needs to run.
  const rawWorkerUserPlugins = (
    (await asyncFlatten(config.worker?.plugins || [])) as Plugin[]
  ).filter(filterPlugin)

  // resolve plugins
  const rawUserPlugins = (
    (await asyncFlatten(config.plugins || [])) as Plugin[]
  ).filter(filterPlugin)

  const [prePlugins, normalPlugins, postPlugins] =
    sortUserPlugins(rawUserPlugins)

  // run config hooks
  const userPlugins = [...prePlugins, ...normalPlugins, ...postPlugins]
  config = await runConfigHook(config, userPlugins, configEnv)

  // If there are custom commonjsOptions, don't force optimized deps for this test
  // even if the env var is set as it would interfere with the playground specs.
  if (
    !config.build?.commonjsOptions &&
    process.env.VITE_TEST_WITHOUT_PLUGIN_COMMONJS
  ) {
    config = mergeConfig(config, {
      optimizeDeps: { disabled: false },
      ssr: { optimizeDeps: { disabled: false } },
    })
    config.build ??= {}
    config.build.commonjsOptions = { include: [] }
  }

  // Define logger
  const logger = createLogger(config.logLevel, {
    allowClearScreen: config.clearScreen,
    customLogger: config.customLogger,
  })

  let foundDiscouragedVariableName
  if (
    (foundDiscouragedVariableName = Object.keys(config.define ?? {}).find((k) =>
      ['process', 'global'].includes(k),
    ))
  ) {
    logger.warn(
      colors.yellow(
        `Replacing ${colors.bold(
          foundDiscouragedVariableName,
        )} using the define option is discouraged. See https://vitejs.dev/config/shared-options.html#define for more details.`,
      ),
    )
  }

  // resolve root
  const resolvedRoot = normalizePath(
    config.root ? path.resolve(config.root) : process.cwd(),
  )
  if (resolvedRoot.includes('#')) {
    logger.warn(
      colors.yellow(
        `The project root contains the "#" character (${colors.cyan(
          resolvedRoot,
        )}), which may not work when running Vite. Consider renaming the directory to remove the "#".`,
      ),
    )
  }

  const clientAlias = [
    {
      find: /^\/?@vite\/env/,
      replacement: path.posix.join(FS_PREFIX, normalizePath(ENV_ENTRY)),
    },
    {
      find: /^\/?@vite\/client/,
      replacement: path.posix.join(FS_PREFIX, normalizePath(CLIENT_ENTRY)),
    },
  ]

  // resolve alias with internal client alias
  const resolvedAlias = normalizeAlias(
    mergeAlias(clientAlias, config.resolve?.alias || []),
  )

  const resolveOptions: ResolvedConfig['resolve'] = {
    mainFields: config.resolve?.mainFields ?? DEFAULT_MAIN_FIELDS,
    browserField: config.resolve?.browserField ?? true,
    conditions: config.resolve?.conditions ?? [],
    extensions: config.resolve?.extensions ?? DEFAULT_EXTENSIONS,
    dedupe: config.resolve?.dedupe ?? [],
    preserveSymlinks: config.resolve?.preserveSymlinks ?? false,
    alias: resolvedAlias,
  }

  // load .env files
  const envDir = config.envDir
    ? normalizePath(path.resolve(resolvedRoot, config.envDir))
    : resolvedRoot
  const userEnv =
    inlineConfig.envFile !== false &&
    loadEnv(mode, envDir, resolveEnvPrefix(config))

  // Note it is possible for user to have a custom mode, e.g. `staging` where
  // development-like behavior is expected. This is indicated by NODE_ENV=development
  // loaded from `.staging.env` and set by us as VITE_USER_NODE_ENV
  const userNodeEnv = process.env.VITE_USER_NODE_ENV
  if (!isNodeEnvSet && userNodeEnv) {
    if (userNodeEnv === 'development') {
      process.env.NODE_ENV = 'development'
    } else {
      // NODE_ENV=production is not supported as it could break HMR in dev for frameworks like Vue
      logger.warn(
        `NODE_ENV=${userNodeEnv} is not supported in the .env file. ` +
          `Only NODE_ENV=development is supported to create a development build of your project. ` +
          `If you need to set process.env.NODE_ENV, you can set it in the Vite config instead.`,
      )
    }
  }

  const isProduction = process.env.NODE_ENV === 'production'

  // resolve public base url
  const isBuild = command === 'build'
  const relativeBaseShortcut = config.base === '' || config.base === './'

  // During dev, we ignore relative base and fallback to '/'
  // For the SSR build, relative base isn't possible by means
  // of import.meta.url.
  const resolvedBase = relativeBaseShortcut
    ? !isBuild || config.build?.ssr
      ? '/'
      : './'
    : resolveBaseUrl(config.base, isBuild, logger) ?? '/'

  const resolvedBuildOptions = resolveBuildOptions(
    config.build,
    logger,
    resolvedRoot,
  )

  // resolve cache directory
  const pkgDir = findNearestPackageData(resolvedRoot, packageCache)?.dir
  const cacheDir = normalizePath(
    config.cacheDir
      ? path.resolve(resolvedRoot, config.cacheDir)
      : pkgDir
      ? path.join(pkgDir, `node_modules/.vite`)
      : path.join(resolvedRoot, `.vite`),
  )

  const assetsFilter =
    config.assetsInclude &&
    (!Array.isArray(config.assetsInclude) || config.assetsInclude.length)
      ? createFilter(config.assetsInclude)
      : () => false

  // create an internal resolver to be used in special scenarios, e.g.
  // optimizer & handling css @imports
  const createResolver: ResolvedConfig['createResolver'] = (options) => {
    let aliasContainer: PluginContainer | undefined
    let resolverContainer: PluginContainer | undefined
    return async (id, importer, aliasOnly, ssr) => {
      let container: PluginContainer
      if (aliasOnly) {
        container =
          aliasContainer ||
          (aliasContainer = await createPluginContainer({
            ...resolved,
            plugins: [aliasPlugin({ entries: resolved.resolve.alias })],
          }))
      } else {
        container =
          resolverContainer ||
          (resolverContainer = await createPluginContainer({
            ...resolved,
            plugins: [
              aliasPlugin({ entries: resolved.resolve.alias }),
              resolvePlugin({
                ...resolved.resolve,
                root: resolvedRoot,
                isProduction,
                isBuild: command === 'build',
                ssrConfig: resolved.ssr,
                asSrc: true,
                preferRelative: false,
                tryIndex: true,
                ...options,
                idOnly: true,
              }),
            ],
          }))
      }
      return (
        await container.resolveId(id, importer, {
          ssr,
          scan: options?.scan,
        })
      )?.id
    }
  }

  const { publicDir } = config
  const resolvedPublicDir =
    publicDir !== false && publicDir !== ''
      ? path.resolve(
          resolvedRoot,
          typeof publicDir === 'string' ? publicDir : 'public',
        )
      : ''

  const server = resolveServerOptions(resolvedRoot, config.server, logger)
  const ssr = resolveSSROptions(config.ssr, resolveOptions.preserveSymlinks)

  const middlewareMode = config?.server?.middlewareMode

  const optimizeDeps = config.optimizeDeps || {}

  const BASE_URL = resolvedBase

  // resolve worker
  let workerConfig = mergeConfig({}, config)
  const [workerPrePlugins, workerNormalPlugins, workerPostPlugins] =
    sortUserPlugins(rawWorkerUserPlugins)

  // run config hooks
  const workerUserPlugins = [
    ...workerPrePlugins,
    ...workerNormalPlugins,
    ...workerPostPlugins,
  ]
  workerConfig = await runConfigHook(workerConfig, workerUserPlugins, configEnv)
  const resolvedWorkerOptions: ResolveWorkerOptions = {
    format: workerConfig.worker?.format || 'iife',
    plugins: [],
    rollupOptions: workerConfig.worker?.rollupOptions || {},
    getSortedPlugins: undefined!,
    getSortedPluginHooks: undefined!,
  }

  const resolvedConfig: ResolvedConfig = {
    configFile: configFile ? normalizePath(configFile) : undefined,
    configFileDependencies: configFileDependencies.map((name) =>
      normalizePath(path.resolve(name)),
    ),
    inlineConfig,
    root: resolvedRoot,
    base: withTrailingSlash(resolvedBase),
    rawBase: resolvedBase,
    resolve: resolveOptions,
    publicDir: resolvedPublicDir,
    cacheDir,
    command,
    mode,
    ssr,
    isWorker: false,
    mainConfig: null,
    isProduction,
    plugins: userPlugins,
    css: resolveCSSOptions(config.css),
    esbuild:
      config.esbuild === false
        ? false
        : {
            jsxDev: !isProduction,
            ...config.esbuild,
          },
    server,
    build: resolvedBuildOptions,
    preview: {}, // resolvePreviewOptions(config.preview, server),
    envDir,
    env: {
      ...userEnv,
      BASE_URL,
      MODE: mode,
      DEV: !isProduction,
      PROD: isProduction,
    },
    assetsInclude(file: string) {
      return DEFAULT_ASSETS_RE.test(file) || assetsFilter(file)
    },
    logger,
    packageCache,
    createResolver,
    optimizeDeps: {
      disabled: 'build',
      ...optimizeDeps,
      esbuildOptions: {
        preserveSymlinks: resolveOptions.preserveSymlinks,
        ...optimizeDeps.esbuildOptions,
      },
    },
    worker: resolvedWorkerOptions,
    appType: config.appType ?? (middlewareMode === 'ssr' ? 'custom' : 'spa'),
    experimental: {
      importGlobRestoreExtension: false,
      hmrPartialAccept: false,
      ...config.experimental,
    },
    getSortedPlugins: undefined!,
    getSortedPluginHooks: undefined!,
  }
  const resolved: ResolvedConfig = {
    ...config,
    ...resolvedConfig,
  }

  ;(resolved.plugins as Plugin[]) = await resolvePlugins(
    resolved,
    prePlugins,
    normalPlugins,
    postPlugins,
  )
  Object.assign(resolved, createPluginHookUtils(resolved.plugins))

  const workerResolved: ResolvedConfig = {
    ...workerConfig,
    ...resolvedConfig,
    isWorker: true,
    mainConfig: resolved,
  }
  resolvedConfig.worker.plugins = await resolvePlugins(
    workerResolved,
    workerPrePlugins,
    workerNormalPlugins,
    workerPostPlugins,
  )
  Object.assign(
    resolvedConfig.worker,
    createPluginHookUtils(resolvedConfig.worker.plugins),
  )

  // call configResolved hooks
  await Promise.all([
    ...resolved
      .getSortedPluginHooks('configResolved')
      .map((hook) => hook(resolved)),
    ...resolvedConfig.worker
      .getSortedPluginHooks('configResolved')
      .map((hook) => hook(workerResolved)),
  ])

  // validate config

  if (middlewareMode === 'ssr') {
    logger.warn(
      colors.yellow(
        `Setting server.middlewareMode to 'ssr' is deprecated, set server.middlewareMode to \`true\`${
          config.appType === 'custom' ? '' : ` and appType to 'custom'`
        } instead`,
      ),
    )
  } else if (middlewareMode === 'html') {
    logger.warn(
      colors.yellow(
        `Setting server.middlewareMode to 'html' is deprecated, set server.middlewareMode to \`true\` instead`,
      ),
    )
  }

  if (
    config.server?.force &&
    !isBuild &&
    config.optimizeDeps?.force === undefined
  ) {
    resolved.optimizeDeps.force = true
    logger.warn(
      colors.yellow(
        `server.force is deprecated, use optimizeDeps.force instead`,
      ),
    )
  }

  debug?.(`using resolved config: %O`, {
    ...resolved,
    plugins: resolved.plugins.map((p) => p.name),
    worker: {
      ...resolved.worker,
      plugins: resolved.worker.plugins.map((p) => p.name),
    },
  })

  if (config.build?.terserOptions && config.build.minify !== 'terser') {
    logger.warn(
      colors.yellow(
        `build.terserOptions is specified but build.minify is not set to use Terser. ` +
          `Note Vite now defaults to use esbuild for minification. If you still ` +
          `prefer Terser, set build.minify to "terser".`,
      ),
    )
  }

  // Check if all assetFileNames have the same reference.
  // If not, display a warn for user.
  const outputOption = config.build?.rollupOptions?.output ?? []
  // Use isArray to narrow its type to array
  if (Array.isArray(outputOption)) {
    const assetFileNamesList = outputOption.map(
      (output) => output.assetFileNames,
    )
    if (assetFileNamesList.length > 1) {
      const firstAssetFileNames = assetFileNamesList[0]
      const hasDifferentReference = assetFileNamesList.some(
        (assetFileNames) => assetFileNames !== firstAssetFileNames,
      )
      if (hasDifferentReference) {
        resolved.logger.warn(
          colors.yellow(`
assetFileNames isn't equal for every build.rollupOptions.output. A single pattern across all outputs is supported by Vite.
`),
        )
      }
    }
  }

  // Warn about removal of experimental features
  if (
    // @ts-expect-error Option removed
    config.legacy?.buildSsrCjsExternalHeuristics ||
    // @ts-expect-error Option removed
    config.ssr?.format === 'cjs'
  ) {
    resolved.logger.warn(
      colors.yellow(`
(!) Experimental legacy.buildSsrCjsExternalHeuristics and ssr.format were be removed in Vite 5.
    The only SSR Output format is ESM. Find more information at https://github.com/vitejs/vite/discussions/13816.
`),
    )
  }

  return resolved
}

/**
 * Resolve base url. Note that some users use Vite to build for non-web targets like
 * electron or expects to deploy
 */
export function resolveBaseUrl(
  base: UserConfig['base'] = '/',
  isBuild: boolean,
  logger: Logger,
): string {
  if (base[0] === '.') {
    logger.warn(
      colors.yellow(
        colors.bold(
          `(!) invalid "base" option: ${base}. The value can only be an absolute ` +
            `URL, ./, or an empty string.`,
        ),
      ),
    )
    return '/'
  }

  // external URL flag
  const isExternal = isExternalUrl(base)
  // no leading slash warn
  if (!isExternal && base[0] !== '/') {
    logger.warn(
      colors.yellow(
        colors.bold(`(!) "base" option should start with a slash.`),
      ),
    )
  }

  // parse base when command is serve or base is not External URL
  if (!isBuild || !isExternal) {
    base = new URL(base, 'http://vitejs.dev').pathname
    // ensure leading slash
    if (base[0] !== '/') {
      base = '/' + base
    }
  }

  return base
}

export function sortUserPlugins(
  plugins: (Plugin | Plugin[])[] | undefined,
): [Plugin[], Plugin[], Plugin[]] {
  const prePlugins: Plugin[] = []
  const postPlugins: Plugin[] = []
  const normalPlugins: Plugin[] = []

  if (plugins) {
    plugins.flat().forEach((p) => {
      if (p.enforce === 'pre') prePlugins.push(p)
      else if (p.enforce === 'post') postPlugins.push(p)
      else normalPlugins.push(p)
    })
  }

  return [prePlugins, normalPlugins, postPlugins]
}

export async function loadConfigFromFile(
  configEnv: ConfigEnv,
  configFile?: string,
  configRoot: string = process.cwd(),
  logLevel?: LogLevel,
): Promise<{
  path: string
  config: UserConfig
  dependencies: string[]
} | null> {
  const start = performance.now()
  const getTime = () => `${(performance.now() - start).toFixed(2)}ms`

  let resolvedPath: string | undefined

  if (configFile) {
    // explicit config path is always resolved from cwd
    resolvedPath = path.resolve(configFile)
  } else {
    // implicit config file loaded from inline root (if present)
    // otherwise from cwd
    for (const filename of DEFAULT_CONFIG_FILES) {
      const filePath = path.resolve(configRoot, filename)
      if (!fs.existsSync(filePath)) continue

      resolvedPath = filePath
      break
    }
  }

  if (!resolvedPath) {
    debug?.('no config file found.')
    return null
  }

  let isESM = false
  if (/\.m[jt]s$/.test(resolvedPath)) {
    isESM = true
  } else if (/\.c[jt]s$/.test(resolvedPath)) {
    isESM = false
  } else {
    // check package.json for type: "module" and set `isESM` to true
    try {
      const pkg = lookupFile(configRoot, ['package.json'])
      isESM =
        !!pkg && JSON.parse(fs.readFileSync(pkg, 'utf-8')).type === 'module'
    } catch (e) {}
  }

  try {
    const bundled = await bundleConfigFile(resolvedPath, isESM)
    const userConfig = await loadConfigFromBundledFile(
      resolvedPath,
      bundled.code,
      isESM,
    )
    debug?.(`bundled config file loaded in ${getTime()}`)

    const config = await (typeof userConfig === 'function'
      ? userConfig(configEnv)
      : userConfig)
    if (!isObject(config)) {
      throw new Error(`config must export or return an object.`)
    }
    return {
      path: normalizePath(resolvedPath),
      config,
      dependencies: bundled.dependencies,
    }
  } catch (e) {
    createLogger(logLevel).error(
      colors.red(`failed to load config from ${resolvedPath}`),
      { error: e },
    )
    throw e
  }
}

async function bundleConfigFile(
  fileName: string,
  isESM: boolean,
): Promise<{ code: string; dependencies: string[] }> {
  const dirnameVarName = '__vite_injected_original_dirname'
  const filenameVarName = '__vite_injected_original_filename'
  const importMetaUrlVarName = '__vite_injected_original_import_meta_url'
  const result = await build({
    absWorkingDir: process.cwd(),
    entryPoints: [fileName],
    write: false,
    target: ['node18'],
    platform: 'node',
    bundle: true,
    format: isESM ? 'esm' : 'cjs',
    mainFields: ['main'],
    sourcemap: 'inline',
    metafile: true,
    define: {
      __dirname: dirnameVarName,
      __filename: filenameVarName,
      'import.meta.url': importMetaUrlVarName,
    },
    plugins: [
      {
        name: 'externalize-deps',
        setup(build) {
          const packageCache = new Map()
          const resolveByViteResolver = (
            id: string,
            importer: string,
            isRequire: boolean,
          ) => {
            return tryNodeResolve(
              id,
              importer,
              {
                root: path.dirname(fileName),
                isBuild: true,
                isProduction: true,
                preferRelative: false,
                tryIndex: true,
                mainFields: [],
                browserField: false,
                conditions: [],
                overrideConditions: ['node'],
                dedupe: [],
                extensions: DEFAULT_EXTENSIONS,
                preserveSymlinks: false,
                packageCache,
                isRequire,
              },
              false,
            )?.id
          }
          const isESMFile = (id: string): boolean => {
            if (id.endsWith('.mjs')) return true
            if (id.endsWith('.cjs')) return false

            const nearestPackageJson = findNearestPackageData(
              path.dirname(id),
              packageCache,
            )
            return (
              !!nearestPackageJson && nearestPackageJson.data.type === 'module'
            )
          }

          // externalize bare imports
          build.onResolve(
            { filter: /^[^.].*/ },
            async ({ path: id, importer, kind }) => {
              if (
                kind === 'entry-point' ||
                path.isAbsolute(id) ||
                isNodeBuiltin(id)
              ) {
                return
              }

              // With the `isNodeBuiltin` check above, this check captures if the builtin is a
              // non-node built-in, which esbuild doesn't know how to handle. In that case, we
              // externalize it so the non-node runtime handles it instead.
              if (isBuiltin(id)) {
                return { external: true }
              }

              const isImport = isESM || kind === 'dynamic-import'
              let idFsPath: string | undefined
              try {
                idFsPath = resolveByViteResolver(id, importer, !isImport)
              } catch (e) {
                if (!isImport) {
                  let canResolveWithImport = false
                  try {
                    canResolveWithImport = !!resolveByViteResolver(
                      id,
                      importer,
                      false,
                    )
                  } catch {}
                  if (canResolveWithImport) {
                    throw new Error(
                      `Failed to resolve ${JSON.stringify(
                        id,
                      )}. This package is ESM only but it was tried to load by \`require\`. See http://vitejs.dev/guide/troubleshooting.html#this-package-is-esm-only for more details.`,
                    )
                  }
                }
                throw e
              }
              if (idFsPath && isImport) {
                idFsPath = pathToFileURL(idFsPath).href
              }
              if (idFsPath && !isImport && isESMFile(idFsPath)) {
                throw new Error(
                  `${JSON.stringify(
                    id,
                  )} resolved to an ESM file. ESM file cannot be loaded by \`require\`. See http://vitejs.dev/guide/troubleshooting.html#this-package-is-esm-only for more details.`,
                )
              }
              return {
                path: idFsPath,
                external: true,
              }
            },
          )
        },
      },
      {
        name: 'inject-file-scope-variables',
        setup(build) {
          build.onLoad({ filter: /\.[cm]?[jt]s$/ }, async (args) => {
            const contents = await fsp.readFile(args.path, 'utf8')
            const injectValues =
              `const ${dirnameVarName} = ${JSON.stringify(
                path.dirname(args.path),
              )};` +
              `const ${filenameVarName} = ${JSON.stringify(args.path)};` +
              `const ${importMetaUrlVarName} = ${JSON.stringify(
                pathToFileURL(args.path).href,
              )};`

            return {
              loader: args.path.endsWith('ts') ? 'ts' : 'js',
              contents: injectValues + contents,
            }
          })
        },
      },
    ],
  })
  const { text } = result.outputFiles[0]
  return {
    code: text,
    dependencies: result.metafile ? Object.keys(result.metafile.inputs) : [],
  }
}

interface NodeModuleWithCompile extends NodeModule {
  _compile(code: string, filename: string): any
}

const _require = createRequire(import.meta.url)
async function loadConfigFromBundledFile(
  fileName: string,
  bundledCode: string,
  isESM: boolean,
): Promise<UserConfigExport> {
  // for esm, before we can register loaders without requiring users to run node
  // with --experimental-loader themselves, we have to do a hack here:
  // write it to disk, load it with native Node ESM, then delete the file.
  if (isESM) {
    const fileBase = `${fileName}.timestamp-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`
    const fileNameTmp = `${fileBase}.mjs`
    const fileUrl = `${pathToFileURL(fileBase)}.mjs`
    await fsp.writeFile(fileNameTmp, bundledCode)
    try {
      return (await dynamicImport(fileUrl)).default
    } finally {
      fs.unlink(fileNameTmp, () => {}) // Ignore errors
    }
  }
  // for cjs, we can register a custom loader via `_require.extensions`
  else {
    const extension = path.extname(fileName)
    // We don't use fsp.realpath() here because it has the same behaviour as
    // fs.realpath.native. On some Windows systems, it returns uppercase volume
    // letters (e.g. "C:\") while the Node.js loader uses lowercase volume letters.
    // See https://github.com/vitejs/vite/issues/12923
    const realFileName = await promisifiedRealpath(fileName)
    const loaderExt = extension in _require.extensions ? extension : '.js'
    const defaultLoader = _require.extensions[loaderExt]!
    _require.extensions[loaderExt] = (module: NodeModule, filename: string) => {
      if (filename === realFileName) {
        ;(module as NodeModuleWithCompile)._compile(bundledCode, filename)
      } else {
        defaultLoader(module, filename)
      }
    }
    // clear cache in case of server restart
    delete _require.cache[_require.resolve(fileName)]
    const raw = _require(fileName)
    _require.extensions[loaderExt] = defaultLoader
    return raw.__esModule ? raw.default : raw
  }
}

async function runConfigHook(
  config: InlineConfig,
  plugins: Plugin[],
  configEnv: ConfigEnv,
): Promise<InlineConfig> {
  let conf = config

  for (const p of getSortedPluginsByHook('config', plugins)) {
    const hook = p.config
    const handler = hook && 'handler' in hook ? hook.handler : hook
    if (handler) {
      const res = await handler(conf, configEnv)
      if (res) {
        conf = mergeConfig(conf, res)
      }
    }
  }

  return conf
}

export function getDepOptimizationConfig(
  config: ResolvedConfig,
  ssr: boolean,
): DepOptimizationConfig {
  return ssr ? config.ssr.optimizeDeps : config.optimizeDeps
}
export function isDepsOptimizerEnabled(
  config: ResolvedConfig,
  ssr: boolean,
): boolean {
  const { command } = config
  const { disabled } = getDepOptimizationConfig(config, ssr)
  return !(
    disabled === true ||
    (command === 'build' && disabled === 'build') ||
    (command === 'serve' && disabled === 'dev')
  )
}
