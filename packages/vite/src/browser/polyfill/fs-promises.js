/* eslint-disable n/no-extraneous-import */
import { fs } from 'memfs'

const promises = fs.promises

export const { lstat, mkdir, readdir, readFile, realpath, writeFile } = promises

export default promises
