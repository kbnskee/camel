'use strict';

const zlib = require('zlib');

function gunzip(buf) {
  return new Promise((resolve, reject) => zlib.gunzip(buf, (e, r) => e ? reject(e) : resolve(r)));
}

/**
 * Extract a single file from a .tgz buffer by exact path.
 * npm tarballs always prefix everything with "package/".
 */
async function extractFile(tgzBuf, targetPath) {
  const tar = await gunzip(tgzBuf);
  let offset = 0;

  while (offset + 512 <= tar.length) {
    const hdr = tar.slice(offset, offset + 512);
    if (hdr.every(b => b === 0)) break; // end-of-archive sentinel

    // File name: bytes 0-99
    let nameEnd = hdr.indexOf(0, 0);
    let name = hdr.slice(0, nameEnd < 0 ? 100 : nameEnd).toString('utf8');

    // ustar prefix: bytes 345-499
    const magic = hdr.slice(257, 263).toString('ascii');
    if (magic.startsWith('ustar')) {
      let pEnd = hdr.indexOf(0, 345);
      const prefix = hdr.slice(345, pEnd < 0 ? 499 : pEnd).toString('utf8');
      if (prefix) name = `${prefix}/${name}`;
    }

    // File size: bytes 124-135 (octal)
    const size = parseInt(hdr.slice(124, 136).toString('ascii').replace(/\0/g, '').trim(), 8) || 0;
    const typeFlag = String.fromCharCode(hdr[156]);

    offset += 512;

    const isFile = typeFlag === '0' || typeFlag === '\0' || typeFlag === '';
    if (isFile && size > 0) {
      const normalized = name.replace(/^\.?\//, '');
      if (normalized === targetPath) {
        return tar.slice(offset, offset + size);
      }
    }

    offset += Math.ceil(size / 512) * 512;
  }
  return null;
}

async function readPackageJson(tgzBuf) {
  const data = await extractFile(tgzBuf, 'package/package.json');
  if (!data) return null;
  try { return JSON.parse(data.toString('utf8')); } catch { return null; }
}

module.exports = { extractFile, readPackageJson };
