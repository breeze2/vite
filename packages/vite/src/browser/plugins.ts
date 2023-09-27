import aliasPlugin from '@rollup/plugin-alias'
import type { PluginHookUtils, ResolvedConfig } from '../node/config'
import type { HookHandler, Plugin } from '../node/plugin'
import { getDepsOptimizer } from '../node/optimizer'
// import { shouldExternalizeForSSR } from '../node/ssr/ssrExternal'
import { watchPackageDataPlugin } from '../node/packages'
import { jsonPlugin } from '../node/plugins/json'
import { resolvePlugin } from '../node/plugins/resolve'
import {
  optimizedDepsBuildPlugin,
  optimizedDepsPlugin,
} from '../node/plugins/optimizedDeps'
import { esbuildPlugin } from '../node/plugins/esbuild'
import { importAnalysisPlugin } from '../node/plugins/importAnalysis'
import { cssPlugin, cssPostPlugin } from '../node/plugins/css'
import { assetPlugin } from '../node/plugins/asset'
import { clientInjectionsPlugin } from '../node/plugins/clientInjections'
import { buildHtmlPlugin, htmlInlineProxyPlugin } from '../node/plugins/html'
import { wasmFallbackPlugin, wasmHelperPlugin } from '../node/plugins/wasm'
import { modulePreloadPolyfillPlugin } from '../node/plugins/modulePreloadPolyfill'
import { webWorkerPlugin } from '../node/plugins/worker'
import { preAliasPlugin } from '../node/plugins/preAlias'
import { definePlugin } from '../node/plugins/define'
import { workerImportMetaUrlPlugin } from '../node/plugins/workerImportMetaUrl'
import { assetImportMetaUrlPlugin } from '../node/plugins/assetImportMetaUrl'
import { ensureWatchPlugin } from '../node/plugins/ensureWatch'
import { metadataPlugin } from '../node/plugins/metadata'
import { dynamicImportVarsPlugin } from '../node/plugins/dynamicImportVars'
import { importGlobPlugin } from '../node/plugins/importMetaGlob'
import { isDepsOptimizerEnabled } from './config'

export async function resolvePlugins(
  config: ResolvedConfig,
  prePlugins: Plugin[],
  normalPlugins: Plugin[],
  postPlugins: Plugin[],
): Promise<Plugin[]> {
  const isBuild = config.command === 'build'
  const isWatch = isBuild && !!config.build.watch
  const buildPlugins = isBuild
    ? await (await import('./build')).resolveBuildPlugins(config)
    : { pre: [], post: [] }
  const { modulePreload } = config.build

  return [
    ...(isDepsOptimizerEnabled(config, false) ||
    isDepsOptimizerEnabled(config, true)
      ? [
          isBuild
            ? optimizedDepsBuildPlugin(config)
            : optimizedDepsPlugin(config),
        ]
      : []),
    isWatch ? ensureWatchPlugin() : null,
    isBuild ? metadataPlugin() : null,
    watchPackageDataPlugin(config.packageCache),
    preAliasPlugin(config),
    aliasPlugin({ entries: config.resolve.alias }),
    ...prePlugins,
    modulePreload !== false && modulePreload.polyfill
      ? modulePreloadPolyfillPlugin(config)
      : null,
    resolvePlugin({
      ...config.resolve,
      root: config.root,
      isProduction: config.isProduction,
      isBuild,
      packageCache: config.packageCache,
      ssrConfig: config.ssr,
      asSrc: true,
      getDepsOptimizer: (ssr: boolean) => getDepsOptimizer(config, ssr),
      shouldExternalize: undefined,
      // isBuild && config.build.ssr
      //   ? (id, importer) => shouldExternalizeForSSR(id, importer, config)
      //   : undefined,
    }),
    htmlInlineProxyPlugin(config),
    cssPlugin(config),
    config.esbuild !== false ? esbuildPlugin(config) : null,
    jsonPlugin(
      {
        namedExports: true,
        ...config.json,
      },
      isBuild,
    ),
    wasmHelperPlugin(config),
    webWorkerPlugin(config),
    assetPlugin(config),
    ...normalPlugins,
    wasmFallbackPlugin(),
    definePlugin(config),
    cssPostPlugin(config),
    isBuild && buildHtmlPlugin(config),
    workerImportMetaUrlPlugin(config),
    assetImportMetaUrlPlugin(config),
    ...buildPlugins.pre,
    dynamicImportVarsPlugin(config),
    importGlobPlugin(config),
    ...postPlugins,
    ...buildPlugins.post,
    // internal server-only plugins are always applied after everything else
    ...(isBuild
      ? []
      : [clientInjectionsPlugin(config), importAnalysisPlugin(config)]),
  ].filter(Boolean) as Plugin[]
}

export function createPluginHookUtils(
  plugins: readonly Plugin[],
): PluginHookUtils {
  // sort plugins per hook
  const sortedPluginsCache = new Map<keyof Plugin, Plugin[]>()
  function getSortedPlugins(hookName: keyof Plugin): Plugin[] {
    if (sortedPluginsCache.has(hookName))
      return sortedPluginsCache.get(hookName)!
    const sorted = getSortedPluginsByHook(hookName, plugins)
    sortedPluginsCache.set(hookName, sorted)
    return sorted
  }
  function getSortedPluginHooks<K extends keyof Plugin>(
    hookName: K,
  ): NonNullable<HookHandler<Plugin[K]>>[] {
    const plugins = getSortedPlugins(hookName)
    return plugins
      .map((p) => {
        const hook = p[hookName]!
        return typeof hook === 'object' && 'handler' in hook
          ? hook.handler
          : hook
      })
      .filter(Boolean)
  }

  return {
    getSortedPlugins,
    getSortedPluginHooks,
  }
}

export function getSortedPluginsByHook(
  hookName: keyof Plugin,
  plugins: readonly Plugin[],
): Plugin[] {
  const pre: Plugin[] = []
  const normal: Plugin[] = []
  const post: Plugin[] = []
  for (const plugin of plugins) {
    const hook = plugin[hookName]
    if (hook) {
      if (typeof hook === 'object') {
        if (hook.order === 'pre') {
          pre.push(plugin)
          continue
        }
        if (hook.order === 'post') {
          post.push(plugin)
          continue
        }
      }
      normal.push(plugin)
    }
  }
  return [...pre, ...normal, ...post]
}
