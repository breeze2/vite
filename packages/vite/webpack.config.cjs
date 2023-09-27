/* eslint-disable import/no-nodejs-modules */
/* eslint-disable no-restricted-globals */
const path = require('path')
const NodePolyfillPlugin = require('node-polyfill-webpack-plugin')
const { NormalModuleReplacementPlugin } = require('webpack')

const root = __dirname

module.exports = {
  entry: './src/browser/serve.ts',
  output: {
    filename: 'serve.js',
    path: path.resolve(root, 'build'),
  },
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
      chokidar: false,
      fs: path.resolve(__dirname, 'src/browser/polyfill/fs.js'),
      fs_promises: path.resolve(
        __dirname,
        'src/browser/polyfill/fs-promises.js',
      ),
      fsevents: false,
      esbuild: path.resolve(__dirname, 'src/browser/polyfill/esbuild.js'),
      mlly: false,
      module: path.resolve(__dirname, 'src/browser/polyfill/module.js'),
      perf_hooks: path.resolve(__dirname, 'src/browser/polyfill/perf-hooks.js'),
      readline: false,
      url: path.resolve(__dirname, 'src/browser/polyfill/url.js'),
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
  ],
  target: 'web',
}
