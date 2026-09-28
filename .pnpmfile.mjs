export const hooks = {
  readPackage(pkg) {
    if (pkg.name === 'mammoth' && pkg.version === '1.12.0') {
      // The application uses the DOCX library API, never mammoth's CLI.
      // argparse 1.x (and its lodash 3.x dependency) is CLI-only.
      delete pkg.dependencies?.argparse;
    }
    return pkg;
  },
};
