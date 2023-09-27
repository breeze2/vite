/* eslint-disable n/no-restricted-require */
/* eslint-disable import/no-nodejs-modules */
/* eslint-disable no-restricted-globals */
const path = require('path')
const NodePolyfillPlugin = require('node-polyfill-webpack-plugin')
const { NormalModuleReplacementPlugin, DefinePlugin } = require('webpack')

const root = __dirname

module.exports = {
  entry: './src/browser/serve.ts',
  output: {
    filename: 'serve.js',
    path: path.resolve(root, 'build'),
  },
  mode: 'development',
  devtool: 'source-map',
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
    alias: {
      child_process: false,
      // chokidar: false,
      dns: false,
      fs: path.resolve(__dirname, 'src/browser/polyfill/fs.js'),
      fs_promises: path.resolve(
        __dirname,
        'src/browser/polyfill/fs-promises.js',
      ),
      fsevents: false,
      esbuild: path.resolve(__dirname, 'src/browser/polyfill/esbuild.js'),
      http2: false,
      lightningcss: false,
      mlly: false,
      module: path.resolve(__dirname, 'src/browser/polyfill/module.js'),
      perf_hooks: path.resolve(__dirname, 'src/browser/polyfill/perf-hooks.js'),
      readline: false,
      'ts-node': false,
      url: path.resolve(__dirname, 'src/browser/polyfill/url.js'),
      worker_threads: false,
      process: false,
    },
    fallback: {},
  },
  plugins: [
    new NormalModuleReplacementPlugin(/node:/, (resource) => {
      resource.request = resource.request.replace(/^node:/, '')
      if (resource.request === 'fs/promises') {
        resource.request = 'fs_promises'
      }
    }),
    new NodePolyfillPlugin(),
    new DefinePlugin({
      'process.env.NODE_ENV': 'process.env.NODE_ENV',
      'process.versions.node': '"18.0.0"',
      'process.stdout.isTTY': '""',
      'process.env.CI': '""',
    }),
  ],
  target: 'web',
}
