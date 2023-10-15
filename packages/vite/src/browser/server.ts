import type * as net from 'node:net'
import type * as http from 'node:http'
import connect from 'connect'
import type { FSWatcher } from 'dep-types/chokidar'
import type { Connect } from 'dep-types/connect'
import type { SourceMap } from 'rollup'
import picomatch from 'picomatch'
import type { InvalidatePayload } from 'types/customEvent'
import type { InlineConfig } from '../node/config'
import { isDepsOptimizerEnabled, resolveConfig } from '../node/config'
import { normalizePath } from '../node/utils'
import { getDepsOptimizer, initDepsOptimizer } from '../node/optimizer'
import { printServerUrls } from '../node/logger'
import { invalidatePackageData } from '../node/packages'
import { createPluginContainer } from '../node/server/pluginContainer'
import type { WebSocketServer } from '../node/server/ws'
import { createDevHtmlTransformFn } from '../node/server/middlewares/indexHtml'
import { ModuleGraph } from '../node/server/moduleGraph'
import { prepareError } from '../node/server/middlewares/error'
import {
  getShortName,
  handleFileAddUnlink,
  handleHMRUpdate,
  updateModules
} from '../node/server/hmr'
import { transformRequest } from '../node/server/transformRequest'
import type { ViteDevServer } from '../node/server'

export async function createServer(
  inlineConfig: InlineConfig = {}
): Promise<ViteDevServer> {
  const config = await resolveConfig(inlineConfig, 'serve', 'development')
  const {
    // root,
    server: serverConfig
  } = config
  // const httpsOptions = await resolveHttpsConfig(config.server.https)
  const { middlewareMode } = serverConfig

  // const resolvedWatchOptions = resolveChokidarOptions({
  //   disableGlobbing: true,
  //   ...serverConfig.watch
  // })

  const middlewares = connect() as Connect.Server
  // const httpServer = middlewareMode
  //   ? null
  //   : await resolveHttpServer(serverConfig, middlewares, httpsOptions)
  // const ws = createWebSocketServer(httpServer, config, httpsOptions)

  // if (httpServer) {
  //   setClientErrorHandler(httpServer, config.logger)
  // }

  // const watcher = chokidar.watch(
  //   path.resolve(root),
  //   resolvedWatchOptions
  // ) as FSWatcher
  const httpServer = null as http.Server | null
  const ws: WebSocketServer = { on: () => ws } as any
  const watcher: FSWatcher = { on: () => watcher } as any

  const moduleGraph: ModuleGraph = new ModuleGraph((url, ssr) =>
    container.resolveId(url, undefined, { ssr })
  )

  const container = await createPluginContainer(config, moduleGraph, watcher)
  // const closeHttpServer = createServerCloseFn(httpServer)

  let exitProcess: () => void

  const server: ViteDevServer = {
    config,
    middlewares,
    httpServer,
    watcher,
    pluginContainer: container,
    ws,
    moduleGraph,
    resolvedUrls: null, // will be set on listen
    ssrTransform(
      code: string,
      _inMap: SourceMap | null,
      _url: string,
      _originalCode = code
    ) {
      throw Error('Not Implemented')
    },
    transformRequest(url, options) {
      return transformRequest(url, server, options)
    },
    transformIndexHtml: null!, // to be immediately set
    async ssrLoadModule(_url, _opts?: { fixStacktrace?: boolean }) {
      throw Error('Not Implemented')
    },
    ssrFixStacktrace(_e) {
      throw Error('Not Implemented')
    },
    ssrRewriteStacktrace(_stack: string) {
      throw Error('Not Implemented')
    },
    async reloadModule(module) {
      if (serverConfig.hmr !== false && module.file) {
        updateModules(module.file, [module], Date.now(), server)
      }
    },
    async listen(_port?: number, _isRestart?: boolean) {
      throw Error('Not Implemented')
    },
    async close() {
      if (!middlewareMode) {
        process.off('SIGTERM', exitProcess)
        if (process.env.CI !== 'true') {
          process.stdin.off('end', exitProcess)
        }
      }
      await Promise.all([
        watcher.close(),
        ws.close(),
        container.close(),
        getDepsOptimizer(server.config)?.close(),
        getDepsOptimizer(server.config, true)?.close()
        // closeHttpServer()
      ])
      server.resolvedUrls = null
    },
    printUrls() {
      if (server.resolvedUrls) {
        printServerUrls(
          server.resolvedUrls,
          serverConfig.host,
          config.logger.info
        )
      } else if (middlewareMode) {
        throw new Error('cannot print server URLs in middleware mode.')
      } else {
        throw new Error(
          'cannot print server URLs before server.listen is called.'
        )
      }
    },
    async restart(_forceOptimize?: boolean) {
      throw Error('Not Implemented')
    },

    _ssrExternals: null,
    _restartPromise: null,
    _importGlobMap: new Map(),
    _forceOptimizeOnRestart: false,
    _pendingRequests: new Map(),
    _fsDenyGlob: picomatch(config.server.fs.deny, { matchBase: true })
  }

  server.transformIndexHtml = createDevHtmlTransformFn(server)

  if (!middlewareMode) {
    exitProcess = async () => {
      try {
        await server.close()
      } finally {
        process.exit()
      }
    }
    process.once('SIGTERM', exitProcess)
    if (process.env.CI !== 'true') {
      process.stdin.on('end', exitProcess)
    }
  }

  const { packageCache } = config
  const setPackageData = packageCache.set.bind(packageCache)
  packageCache.set = (id, pkg) => {
    if (id.endsWith('.json')) {
      watcher.add(id)
    }
    return setPackageData(id, pkg)
  }

  watcher.on('change', async (file) => {
    file = normalizePath(file)
    if (file.endsWith('/package.json')) {
      return invalidatePackageData(packageCache, file)
    }
    // invalidate module graph cache on file change
    moduleGraph.onFileChange(file)
    if (serverConfig.hmr !== false) {
      try {
        await handleHMRUpdate(file, server)
      } catch (err) {
        ws.send({
          type: 'error',
          err: prepareError(err)
        })
      }
    }
  })

  watcher.on('add', (file) => {
    handleFileAddUnlink(normalizePath(file), server)
  })
  watcher.on('unlink', (file) => {
    handleFileAddUnlink(normalizePath(file), server)
  })

  ws.on('vite:invalidate', async ({ path }: InvalidatePayload) => {
    const mod = moduleGraph.urlToModuleMap.get(path)
    if (mod && mod.isSelfAccepting && mod.lastHMRTimestamp > 0) {
      const file = getShortName(mod.file!, config.root)
      updateModules(file, [...mod.importers], mod.lastHMRTimestamp, server)
    }
  })

  if (!middlewareMode && httpServer) {
    httpServer.once('listening', () => {
      // update actual port since this may be different from initial value
      serverConfig.port = (httpServer.address() as net.AddressInfo).port
    })
  }

  // apply server configuration hooks from plugins
  const postHooks: ((() => void) | void)[] = []
  for (const hook of config.getSortedPluginHooks('configureServer')) {
    postHooks.push(await hook(server))
  }

  // Internal middlewares ------------------------------------------------------

  // // request timer
  // if (process.env.DEBUG) {
  //   middlewares.use(timeMiddleware(root))
  // }

  // // cors (enabled by default)
  // const { cors } = serverConfig
  // if (cors !== false) {
  //   middlewares.use(corsMiddleware(typeof cors === 'boolean' ? {} : cors))
  // }

  // // proxy
  // const { proxy } = serverConfig
  // if (proxy) {
  //   // middlewares.use(proxyMiddleware(httpServer, proxy, config))
  // }

  // // base
  // if (config.base !== '/') {
  //   middlewares.use(baseMiddleware(server))
  // }

  // // open in editor support
  // // middlewares.use('/__open-in-editor', launchEditorMiddleware())

  // // serve static files under /public
  // // this applies before the transform middleware so that these files are served
  // // as-is without transforms.
  // if (config.publicDir) {
  //   middlewares.use(
  //     servePublicMiddleware(config.publicDir, config.server.headers)
  //   )
  // }

  // // main transform middleware
  // middlewares.use(transformMiddleware(server))

  // // serve static files
  // middlewares.use(serveRawFsMiddleware(server))
  // middlewares.use(serveStaticMiddleware(root, server))

  // // html fallback
  // if (config.appType === 'spa' || config.appType === 'mpa') {
  //   middlewares.use(htmlFallbackMiddleware(root, config.appType === 'spa'))
  // }

  // // run post config hooks
  // // This is applied before the html middleware so that user middleware can
  // // serve custom content instead of index.html.
  // postHooks.forEach((fn) => fn && fn())

  // if (config.appType === 'spa' || config.appType === 'mpa') {
  //   // transform index.html
  //   middlewares.use(indexHtmlMiddleware(server))

  //   // handle 404s
  //   // Keep the named function. The name is visible in debug logs via `DEBUG=connect:dispatcher ...`
  //   middlewares.use(function vite404Middleware(_, res) {
  //     res.statusCode = 404
  //     res.end()
  //   })
  // }

  // // error handler
  // middlewares.use(errorMiddleware(server, middlewareMode))

  let initingServer: Promise<void> | undefined
  let serverInited = false
  const initServer = async () => {
    if (serverInited) {
      return
    }
    if (initingServer) {
      return initingServer
    }
    initingServer = (async function () {
      await container.buildStart({})
      if (isDepsOptimizerEnabled(config, false)) {
        // non-ssr
        await initDepsOptimizer(config, server)
      }
      initingServer = undefined
      serverInited = true
    })()
    return initingServer
  }

  await initServer()

  return server
}
