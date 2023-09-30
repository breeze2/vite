import { fs } from 'memfs'

export const promises = fs.promises

export const {
  Stats,
  open,
  close,
  createReadStream,
  existsSync,
  readdir,
  readdirSync,
  readFileSync,
  realpath,
  realpathSync,
  lstat,
  stat,
  statSync
} = fs

export default fs
