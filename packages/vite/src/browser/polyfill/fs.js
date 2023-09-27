/* eslint-disable n/no-extraneous-import */
import { fs } from 'memfs'

export const promises = fs.promises

export const {
  createReadStream,
  existsSync,
  readdir,
  readdirSync,
  readFileSync,
  statSync,
} = fs

export default fs
