import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

// Windows exFAT reports EISDIR for readlink on ordinary files. Node tooling
// expects EINVAL for "not a symlink". Normalize only after verifying lstat;
// preserve genuine links and all unrelated filesystem errors.
if (process.platform === 'win32') {
  const original = fs.readlink.bind(fs);
  const originalSync = fs.readlinkSync.bind(fs);
  const originalPromise = fs.promises.readlink.bind(fs.promises);
  function normalize(error, target) {
    if (error?.code === 'EISDIR') {
      try {
        if (!fs.lstatSync(target).isSymbolicLink()) {
          error.code = 'EINVAL';
          error.errno = -4071;
        }
      } catch { /* Preserve the original failure if the target cannot be checked. */ }
    }
    return error;
  }
  fs.readlink = function (target, options, callback) {
    if (typeof options === 'function') { callback = options; options = undefined; }
    return original(target, options, (error, result) => callback(error ? normalize(error, target) : null, result));
  };
  fs.readlinkSync = function (target, options) {
    try { return originalSync(target, options); } catch (error) { throw normalize(error, target); }
  };
  fs.promises.readlink = async function (target, options) {
    try { return await originalPromise(target, options); } catch (error) { throw normalize(error, target); }
  };
  syncBuiltinESMExports();
}
