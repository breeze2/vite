import path from 'node:path'
// import type * as net from 'node:net'
import type * as http from 'node:http'
// import { performance } from 'node:perf_hooks'
import connect from 'connect'
import corsMiddleware from 'cors'
import colors from 'picocolors'
// import chokidar from 'chokidar'
// import type { FSWatcher, WatchOptions } from 'dep-types/chokidar'
import type { Connect } from 'dep-types/connect'
// import launchEditorMiddleware from 'launch-editor-middleware'
import type { SourceMap } from 'rollup'
import picomatch from 'picomatch'
// import type { Matcher } from 'picomatch'
import type { InvalidatePayload } from 'types/customEvent'
// import type { CommonServerOptions } from '../node/http'
// import {
//   httpServerStart,
//   resolveHttpServer,
//   resolveHttpsConfig,
//   setClientErrorHandler,
// } from '../node/http'
import type {
  InlineConfig,
  //  ResolvedConfig
} from '../node/config'
import {
  // diffDnsOrderChange,
  isInNodeModules,
  isParentDirectory,
  // mergeConfig,
  normalizePath,
  // resolveHostname,
  // resolveServerUrls,
} from '../node/utils'
// import { ssrLoadModule } from '../node/ssr/ssrModuleLoader'
// import { ssrFixStacktrace, ssrRewriteStacktrace } from '../node/ssr/ssrStacktrace'
// import { ssrTransform } from '../node/ssr/ssrTransform'
import {
  getDepsOptimizer,
  initDepsOptimizer,
  // initDevSsrDepsOptimizer,
} from '../node/optimizer'
// import { bindCLIShortcuts } from '../node/shortcuts'
// import type { BindCLIShortcutsOptions } from '../node/shortcuts'
import {
  CLIENT_DIR,
  // DEFAULT_DEV_PORT
} from '../node/constants'
import type { Logger } from '../node/logger'
import { printServerUrls } from '../node/logger'
// import { createNoopWatcher, resolveChokidarOptions } from '../node/watch'
// import type { PluginContainer } from '../node/server/pluginContainer'
import { createPluginContainer } from '../node/server/pluginContainer'
// import type { WebSocketServer } from '../node/server/ws'
// import { createWebSocketServer } from '../node/server/ws'
import { baseMiddleware } from '../node/server/middlewares/base'
import { proxyMiddleware } from '../node/server/middlewares/proxy'
import { htmlFallbackMiddleware } from '../node/server/middlewares/htmlFallback'
import { transformMiddleware } from '../node/server/middlewares/transform'
import {
  createDevHtmlTransformFn,
  indexHtmlMiddleware,
} from '../node/server/middlewares/indexHtml'
import {
  servePublicMiddleware,
  serveRawFsMiddleware,
  serveStaticMiddleware,
} from '../node/server/middlewares/static'
import { timeMiddleware } from '../node/server/middlewares/time'
// import type { ModuleNode } from '../node/server/moduleGraph'
import { ModuleGraph } from '../node/server/moduleGraph'
import {
  errorMiddleware,
  // prepareError
} from '../node/server/middlewares/error'
// import type { HmrOptions } from '../node/server/hmr'
import {
  getShortName,
  // handleFileAddUnlink,
  // handleHMRUpdate,
  updateModules,
} from '../node/server/hmr'
// import { openBrowser as _openBrowser } from '../node/server/openBrowser'
// import type { TransformOptions, TransformResult } from '../node/server/transformRequest'
import { transformRequest } from '../node/server/transformRequest'
import { searchForWorkspaceRoot } from '../node/server/searchRoot'
import type {
  ResolvedServerOptions,
  ServerOptions,
  ViteDevServer,
} from '../node/server'
import { isDepsOptimizerEnabled, resolveConfig } from './config'

export function createServer(
  inlineConfig: InlineConfig = {},
): Promise<ViteDevServer> {
  return _createServer(inlineConfig, { ws: true })
}

export async function _createServer(
  inlineConfig: InlineConfig = {},
  options: { ws: boolean },
): Promise<ViteDevServer> {
  const config = await resolveConfig(inlineConfig, 'serve')

  const { root, server: serverConfig } = config
  // const httpsOptions = await resolveHttpsConfig(config.server.https)
  const { middlewareMode } = serverConfig

  // const resolvedWatchOptions = resolveChokidarOptions(config, {
  //   disableGlobbing: true,
  //   ...serverConfig.watch,
  // })

  const middlewares = connect() as Connect.Server
  // const httpServer = middlewareMode
  //   ? null
  //   : await resolveHttpServer(serverConfig, middlewares, httpsOptions)
  // const ws = createWebSocketServer(httpServer, config, httpsOptions)

  // if (httpServer) {
  //   setClientErrorHandler(httpServer, config.logger)
  // }

  const httpServer: http.Server | null = null
  const ws: any = {
    on: (...args: any[]) => undefined,
    send: (...args: any[]) => undefined,
    close: () => undefined,
  }

   
  // const watchEnabled = serverConfig.watch !== null
  // const watcher = watchEnabled
  //   ? (chokidar.watch(
  //       // config file dependencies and env file might be outside of root
  //       [root, ...config.configFileDependencies, config.envDir],
  //       resolvedWatchOptions,
  //     ) as FSWatcher)
  //   : createNoopWatcher(resolvedWatchOptions)
  const watcher = {} as any

  const moduleGraph: ModuleGraph = new ModuleGraph((url, ssr) =>
    container.resolveId(url, undefined, { ssr }),
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
      inMap: SourceMap | { mappings: '' } | null,
      url: string,
      originalCode = code,
    ) {
      // return ssrTransform(code, inMap, url, originalCode, server.config)
      return Promise.resolve(null)
    },
    transformRequest(url, options) {
      return transformRequest(url, server, options)
    },
    transformIndexHtml: null!, // to be immediately set
    async ssrLoadModule(url, opts?: { fixStacktrace?: boolean }) {
      // if (isDepsOptimizerEnabled(config, true)) {
      //   await initDevSsrDepsOptimizer(config, server)
      // }
      // return ssrLoadModule(
      //   url,
      //   server,
      //   undefined,
      //   undefined,
      //   opts?.fixStacktrace,
      // )
      return {} as any
    },
    ssrFixStacktrace(e) {
      // ssrFixStacktrace(e, moduleGraph)
    },
    ssrRewriteStacktrace(stack: string) {
      // return ssrRewriteStacktrace(stack, moduleGraph)
      return ''
    },
    async reloadModule(module) {
      if (serverConfig.hmr !== false && module.file) {
        updateModules(module.file, [module], Date.now(), server)
      }
    },
    async listen(port?: number, isRestart?: boolean) {
      // await startServer(server, port)
      // if (httpServer) {
      //   server.resolvedUrls = await resolveServerUrls(
      //     httpServer,
      //     config.server,
      //     config,
      //   )
      //   if (!isRestart && config.server.open) server.openBrowser()
      // }
      return server
    },
    openBrowser() {
      // const options = server.config.server
      // const url =
      //   server.resolvedUrls?.local[0] ?? server.resolvedUrls?.network[0]
      // if (url) {
      //   const path =
      //     typeof options.open === 'string'
      //       ? new URL(options.open, url).href
      //       : url
      //   _openBrowser(path, true, server.config.logger)
      // } else {
      //   server.config.logger.warn('No URL available to open in browser')
      // }
    },
    async close() {
      if (!middlewareMode) {
        process.off('SIGTERM', exitProcess)
        if (process.env.CI !== 'true') {
          process.stdin.off('end', exitProcess)
        }
      }
      await Promise.allSettled([
        watcher.close(),
        ws.close(),
        container.close(),
        getDepsOptimizer(server.config)?.close(),
        getDepsOptimizer(server.config, true)?.close(),
        // closeHttpServer(),
      ])
      // Await pending requests. We throw early in transformRequest
      // and in hooks if the server is closing for non-ssr requests,
      // so the import analysis plugin stops pre-transforming static
      // imports and this block is resolved sooner.
      // During SSR, we let pending requests finish to avoid exposing
      // the server closed error to the users.
      while (server._pendingRequests.size > 0) {
        await Promise.allSettled(
          [...server._pendingRequests.values()].map(
            (pending) => pending.request,
          ),
        )
      }
      server.resolvedUrls = null
    },
    printUrls() {
      if (server.resolvedUrls) {
        printServerUrls(
          server.resolvedUrls,
          serverConfig.host,
          config.logger.info,
        )
      } else if (middlewareMode) {
        throw new Error('cannot print server URLs in middleware mode.')
      } else {
        throw new Error(
          'cannot print server URLs before server.listen is called.',
        )
      }
    },
    bindCLIShortcuts(options) {
      // bindCLIShortcuts(server, options)
    },
    async restart(forceOptimize?: boolean) {
      // if (!server._restartPromise) {
      //   server._forceOptimizeOnRestart = !!forceOptimize
      //   server._restartPromise = restartServer(server).finally(() => {
      //     server._restartPromise = null
      //     server._forceOptimizeOnRestart = false
      //   })
      // }
      // return server._restartPromise
    },

    _restartPromise: null,
    _importGlobMap: new Map(),
    _forceOptimizeOnRestart: false,
    _pendingRequests: new Map(),
    _fsDenyGlob: picomatch(config.server.fs.deny, { matchBase: true }),
    _shortcutsOptions: undefined,
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

  // const onHMRUpdate = async (file: string, configOnly: boolean) => {
  //   if (serverConfig.hmr !== false) {
  //     try {
  //       await handleHMRUpdate(file, server, configOnly)
  //     } catch (err) {
  //       ws.send({
  //         type: 'error',
  //         err: prepareError(err),
  //       })
  //     }
  //   }
  // }

  // const onFileAddUnlink = async (file: string) => {
  //   file = normalizePath(file)
  //   await handleFileAddUnlink(file, server)
  //   await onHMRUpdate(file, true)
  // }

  // watcher.on('change', async (file) => {
  //   file = normalizePath(file)
  //   // invalidate module graph cache on file change
  //   moduleGraph.onFileChange(file)

  //   await onHMRUpdate(file, false)
  // })

  // watcher.on('add', onFileAddUnlink)
  // watcher.on('unlink', onFileAddUnlink)

  ws.on('vite:invalidate', async ({ path, message }: InvalidatePayload) => {
    const mod = moduleGraph.urlToModuleMap.get(path)
    if (mod && mod.isSelfAccepting && mod.lastHMRTimestamp > 0) {
      config.logger.info(
        colors.yellow(`hmr invalidate `) +
          colors.dim(path) +
          (message ? ` ${message}` : ''),
        { timestamp: true },
      )
      const file = getShortName(mod.file!, config.root)
      updateModules(
        file,
        [...mod.importers],
        mod.lastHMRTimestamp,
        server,
        true,
      )
    }
  })

  if (!middlewareMode && httpServer) {
    // httpServer.once('listening', () => {
    //   // update actual port since this may be different from initial value
    //   serverConfig.port = (httpServer.address() as net.AddressInfo).port
    // })
  }

  // apply server configuration hooks from plugins
  const postHooks: ((() => void) | void)[] = []
  for (const hook of config.getSortedPluginHooks('configureServer')) {
    postHooks.push(await hook(server))
  }

  // Internal middlewares ------------------------------------------------------

  // request timer
  if (process.env.DEBUG) {
    middlewares.use(timeMiddleware(root))
  }

  // cors (enabled by default)
  const { cors } = serverConfig
  if (cors !== false) {
    middlewares.use(corsMiddleware(typeof cors === 'boolean' ? {} : cors))
  }

  // proxy
  const { proxy } = serverConfig
  if (proxy) {
    middlewares.use(proxyMiddleware(httpServer, proxy, config))
  }

  // base
  if (config.base !== '/') {
    middlewares.use(baseMiddleware(server))
  }

  // open in editor support
  // middlewares.use('/__open-in-editor', launchEditorMiddleware())

  // ping request handler
  // Keep the named function. The name is visible in debug logs via `DEBUG=connect:dispatcher ...`
  middlewares.use(function viteHMRPingMiddleware(req, res, next) {
    if (req.headers['accept'] === 'text/x-vite-ping') {
      res.writeHead(204).end()
    } else {
      next()
    }
  })

  // serve static files under /public
  // this applies before the transform middleware so that these files are served
  // as-is without transforms.
  if (config.publicDir) {
    middlewares.use(
      servePublicMiddleware(config.publicDir, config.server.headers),
    )
  }

  // main transform middleware
  middlewares.use(transformMiddleware(server))

  // serve static files
  middlewares.use(serveRawFsMiddleware(server))
  middlewares.use(serveStaticMiddleware(root, server))

  // html fallback
  if (config.appType === 'spa' || config.appType === 'mpa') {
    middlewares.use(htmlFallbackMiddleware(root, config.appType === 'spa'))
  }

  // run post config hooks
  // This is applied before the html middleware so that user middleware can
  // serve custom content instead of index.html.
  postHooks.forEach((fn) => fn && fn())

  if (config.appType === 'spa' || config.appType === 'mpa') {
    // transform index.html
    middlewares.use(indexHtmlMiddleware(server))

    // handle 404s
    // Keep the named function. The name is visible in debug logs via `DEBUG=connect:dispatcher ...`
    middlewares.use(function vite404Middleware(_, res) {
      res.statusCode = 404
      res.end()
    })
  }

  // error handler
  middlewares.use(errorMiddleware(server, middlewareMode))

  // httpServer.listen can be called multiple times
  // when port when using next port number
  // this code is to avoid calling buildStart multiple times
  let initingServer: Promise<void> | undefined
  let serverInited = false
  const initServer = async () => {
    if (serverInited) return
    if (initingServer) return initingServer

    initingServer = (async function () {
      await container.buildStart({})
      // start deps optimizer after all container plugins are ready
      if (isDepsOptimizerEnabled(config, false)) {
        await initDepsOptimizer(config, server)
      }
      initingServer = undefined
      serverInited = true
    })()
    return initingServer
  }

  if (!middlewareMode && httpServer) {
    // overwrite listen to init optimizer before server start
    // const listen = httpServer.listen.bind(httpServer)
    // httpServer.listen = (async (port: number, ...args: any[]) => {
    //   try {
    //     // ensure ws server started
    //     ws.listen()
    //     await initServer()
    //   } catch (e) {
    //     httpServer.emit('error', e)
    //     return
    //   }
    //   return listen(port, ...args)
    // }) as any
  } else {
    if (options.ws) {
      ws.listen()
    }
    await initServer()
  }

  return server
}

// async function startServer(
//   server: ViteDevServer,
//   inlinePort?: number,
// ): Promise<void> {
//   const httpServer = server.httpServer
//   if (!httpServer) {
//     throw new Error('Cannot call server.listen in middleware mode.')
//   }

//   const options = server.config.server
//   const port = inlinePort ?? options.port ?? DEFAULT_DEV_PORT
//   const hostname = await resolveHostname(options.host)

//   await httpServerStart(httpServer, {
//     port,
//     strictPort: options.strictPort,
//     host: hostname.host,
//     logger: server.config.logger,
//   })
// }

// function createServerCloseFn(server: http.Server | null) {
//   if (!server) {
//     return () => {}
//   }

//   let hasListened = false
//   const openSockets = new Set<net.Socket>()

//   server.on('connection', (socket) => {
//     openSockets.add(socket)
//     socket.on('close', () => {
//       openSockets.delete(socket)
//     })
//   })

//   server.once('listening', () => {
//     hasListened = true
//   })

//   return () =>
//     new Promise<void>((resolve, reject) => {
//       openSockets.forEach((s) => s.destroy())
//       if (hasListened) {
//         server.close((err) => {
//           if (err) {
//             reject(err)
//           } else {
//             resolve()
//           }
//         })
//       } else {
//         resolve()
//       }
//     })
// }

function resolvedAllowDir(root: string, dir: string): string {
  return normalizePath(path.resolve(root, dir))
}

export function resolveServerOptions(
  root: string,
  raw: ServerOptions | undefined,
  logger: Logger,
): ResolvedServerOptions {
  const server: ResolvedServerOptions = {
    preTransformRequests: true,
    ...(raw as Omit<ResolvedServerOptions, 'sourcemapIgnoreList'>),
    sourcemapIgnoreList:
      raw?.sourcemapIgnoreList === false
        ? () => false
        : raw?.sourcemapIgnoreList || isInNodeModules,
    middlewareMode: !!raw?.middlewareMode,
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
    deny,
  }

  if (server.origin?.endsWith('/')) {
    server.origin = server.origin.slice(0, -1)
    logger.warn(
      colors.yellow(
        `${colors.bold('(!)')} server.origin should not end with "/". Using "${
          server.origin
        }" instead.`,
      ),
    )
  }

  return server
}

// async function restartServer(server: ViteDevServer) {
//   global.__vite_start_time = performance.now()
//   const { port: prevPort, host: prevHost } = server.config.server
//   const shortcutsOptions = server._shortcutsOptions
//   const oldUrls = server.resolvedUrls

//   let inlineConfig = server.config.inlineConfig
//   if (server._forceOptimizeOnRestart) {
//     inlineConfig = mergeConfig(inlineConfig, {
//       optimizeDeps: {
//         force: true,
//       },
//     })
//   }

//   let newServer = null
//   try {
//     // delay ws server listen
//     newServer = await _createServer(inlineConfig, { ws: false })
//   } catch (err: any) {
//     server.config.logger.error(err.message, {
//       timestamp: true,
//     })
//     server.config.logger.error('server restart failed', { timestamp: true })
//     return
//   }

//   await server.close()

//   // Assign new server props to existing server instance
//   Object.assign(server, newServer)

//   const {
//     logger,
//     server: { port, host, middlewareMode },
//   } = server.config
//   if (!middlewareMode) {
//     await server.listen(port, true)
//     logger.info('server restarted.', { timestamp: true })
//     if (
//       (port ?? DEFAULT_DEV_PORT) !== (prevPort ?? DEFAULT_DEV_PORT) ||
//       host !== prevHost ||
//       diffDnsOrderChange(oldUrls, newServer.resolvedUrls)
//     ) {
//       logger.info('')
//       server.printUrls()
//     }
//   } else {
//     server.ws.listen()
//     logger.info('server restarted.', { timestamp: true })
//   }

//   if (shortcutsOptions) {
//     shortcutsOptions.print = false
//     bindCLIShortcuts(newServer, shortcutsOptions)
//   }
// }
