/* eslint-disable import/no-nodejs-modules */
/* eslint-disable node/no-restricted-require */
/* eslint-disable no-restricted-globals */
const path = require('path')
const NodePolyfillPlugin = require('node-polyfill-webpack-plugin')
const {
  DefinePlugin,
  NormalModuleReplacementPlugin,
  ProvidePlugin
} = require('webpack')

const root = __dirname

module.exports = {
  entry: './src/browser/serve.ts',
  output: {
    filename: 'serve.js',
    chunkFilename: 'chunks/dep-[chunkhash].js',
    path: path.resolve(root, 'build')
  },
  mode: 'development',
  devtool: 'source-map',
  module: {
    rules: [
      {
        test: /src\/node\/publicUtils.ts$/,
        loader: 'string-replace-loader',
        options: {
          search: `export { VERSION as rollupVersion } from 'rollup'`,
          replace: `export const rollupVersion = '2'`
        }
      },
      {
        test: /src\/node\/utils.ts$/,
        loader: 'string-replace-loader',
        options: {
          search: 'export const isCaseInsensitiveFS = testCaseInsensitiveFS()',
          replace: 'export const isCaseInsensitiveFS = false'
        }
      },
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/
      }
    ]
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
    alias: {
      dns: false,
      fs: path.resolve(__dirname, 'src/browser/polyfill/fs.js'),
      http: path.resolve(__dirname, 'src/browser/polyfill/http.js'),
      module: path.resolve(__dirname, 'src/browser/polyfill/module.js'),
      perf_hooks: path.resolve(__dirname, 'src/browser/polyfill/perf-hooks.js'),
      readline: false,
      url: path.resolve(__dirname, 'src/browser/polyfill/url.js'),

      esbuild: path.resolve(__dirname, 'src/browser/polyfill/esbuild.js'),
      'postcss-load-config': path.resolve(
        __dirname,
        'src/browser/polyfill/postcss-load-config.js'
      ),
      'process-browserify': path.resolve(
        __dirname,
        'src/browser/polyfill/process.js'
      ),

      [path.resolve(__dirname, 'src/node/plugins/terser.ts')]: path.resolve(
        __dirname,
        'src/browser/plugins/terser.ts'
      )
    },
    fallback: {}
  },
  plugins: [
    new NormalModuleReplacementPlugin(/node:/, (resource) => {
      resource.request = resource.request.replace(/^node:/, '')
    }),
    new NodePolyfillPlugin(),
    new ProvidePlugin({
      process: 'process-browserify',
      global: path.resolve(__dirname, 'src/browser/polyfill/global.js'),
      setImmediate: ['process-browserify', 'nextTick']
    }),
    new DefinePlugin({
      'process.env.NODE_ENV': 'processBrowserify.env.NODE_ENV',
      'process.versions.node': '"16.0.0"',
      'process.stdout.isTTY': 'false'
    })
  ],
  target: 'web'
}
