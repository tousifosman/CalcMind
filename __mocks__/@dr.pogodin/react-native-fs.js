// In-memory stand-in for @dr.pogodin/react-native-fs. The real module loads a
// TurboModule via getEnforcing and cannot run under Jest without a native bridge.
// Tracks every write/move/unlink so atomic-write ordering is assertable.

const DOC_ROOT = '/mock/documents';

/** @type {Map<string, string>} */
let files = new Map();

/** Ordered log of mutating ops for atomicity assertions. */
let ops = [];

/**
 * When set to a positive n, the n-th moveFile call (1-based, since last reset
 * or arm) rejects. Lets tests hit both the primary→.bak and .tmp→primary
 * crash windows.
 */
let failMoveAt = null;
let moveCallCount = 0;
let failMoveMessage = 'simulated crash mid-save';

function resetMemoryFs() {
  files = new Map();
  ops = [];
  failMoveAt = null;
  moveCallCount = 0;
  failMoveMessage = 'simulated crash mid-save';
}

/** Fail the next moveFile (equivalent to `__setFailNthMove(1, message)`). */
function setFailNextMove(message) {
  setFailNthMove(1, message);
}

/** Fail the n-th subsequent moveFile call (1-based). */
function setFailNthMove(n, message) {
  failMoveAt = n;
  moveCallCount = 0;
  failMoveMessage = message || 'simulated crash mid-save';
}

function getOps() {
  return ops.slice();
}

function getFiles() {
  return new Map(files);
}

function ensureParentExists(_path) {
  // mkdir -p semantics: parents are implicit for write/move in this mock.
}

const api = {
  DocumentDirectoryPath: DOC_ROOT,

  async exists(filepath) {
    return files.has(filepath) || [...files.keys()].some(k => k.startsWith(filepath + '/'));
  },

  async mkdir(path) {
    ops.push({ op: 'mkdir', path });
    // Directory presence is implicit; nothing to store.
  },

  async writeFile(path, content, _encoding) {
    ensureParentExists(path);
    files.set(path, String(content));
    ops.push({ op: 'writeFile', path, bytes: String(content).length });
  },

  async readFile(path, _encoding) {
    if (!files.has(path)) {
      const err = new Error(`ENOENT: no such file or directory, open '${path}'`);
      // @ts-ignore
      err.code = 'ENOENT';
      throw err;
    }
    return files.get(path);
  },

  async moveFile(from, into) {
    moveCallCount += 1;
    if (failMoveAt !== null && moveCallCount === failMoveAt) {
      failMoveAt = null;
      throw new Error(failMoveMessage);
    }
    if (!files.has(from)) {
      const err = new Error(`ENOENT: no such file or directory, rename '${from}'`);
      // @ts-ignore
      err.code = 'ENOENT';
      throw err;
    }
    if (files.has(into)) {
      const err = new Error(`EEXIST: file already exists, rename '${into}'`);
      // @ts-ignore
      err.code = 'EEXIST';
      throw err;
    }
    files.set(into, files.get(from));
    files.delete(from);
    ops.push({ op: 'moveFile', from, into });
  },

  async unlink(path) {
    if (!files.has(path)) {
      const err = new Error(`ENOENT: no such file or directory, unlink '${path}'`);
      // @ts-ignore
      err.code = 'ENOENT';
      throw err;
    }
    files.delete(path);
    ops.push({ op: 'unlink', path });
  },

  async readDir(dirpath) {
    const prefix = dirpath.endsWith('/') ? dirpath : dirpath + '/';
    const names = new Set();
    for (const path of files.keys()) {
      if (!path.startsWith(prefix)) {
        continue;
      }
      const rest = path.slice(prefix.length);
      if (!rest || rest.includes('/')) {
        continue;
      }
      names.add(rest);
    }
    return [...names].sort().map(name => {
      const path = prefix + name;
      const content = files.get(path) ?? '';
      return {
        name,
        path,
        size: content.length,
        mtime: null,
        isFile: () => true,
        isDirectory: () => false,
      };
    });
  },

  async readdir(dirpath) {
    const entries = await api.readDir(dirpath);
    return entries.map(e => e.name);
  },

  async stat(filepath) {
    if (!files.has(filepath)) {
      const err = new Error(`ENOENT: no such file or directory, stat '${filepath}'`);
      // @ts-ignore
      err.code = 'ENOENT';
      throw err;
    }
    const content = files.get(filepath);
    return {
      size: content.length,
      isFile: () => true,
      isDirectory: () => false,
      mtime: Date.now(),
      ctime: Date.now(),
      mode: 0,
      originalFilepath: filepath,
      path: filepath,
    };
  },
};

module.exports = {
  __esModule: true,
  ...api,
  // Named exports matching the package surface used by adapter.native.ts
  DocumentDirectoryPath: DOC_ROOT,
  exists: api.exists,
  mkdir: api.mkdir,
  writeFile: api.writeFile,
  readFile: api.readFile,
  moveFile: api.moveFile,
  unlink: api.unlink,
  readDir: api.readDir,
  readdir: api.readdir,
  stat: api.stat,
  // Test helpers (not part of the real package)
  __resetMemoryFs: resetMemoryFs,
  __getOps: getOps,
  __getFiles: getFiles,
  __setFailNextMove: setFailNextMove,
  __setFailNthMove: setFailNthMove,
  __DOC_ROOT: DOC_ROOT,
};
