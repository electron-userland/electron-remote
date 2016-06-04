import rx from 'rx-dom';
import promisify from 'pify';

const toInclude = ['ajax', 'get', 'getJSON', 'post'];
const fs = promisify(require('fs'));

if (!('type' in process)) {
  global.XMLHttpRequest = require('xmlhttprequest').XMLHttpRequest;
}

module.exports = toInclude.reduce((acc, k) => {
  acc[k] = (...args) => {
    let stall = Promise.resolve(true);
    if (!root.window || !root.window.document) {
      stall = new Promise((res) => setTimeout(res, 100));
    }

    return stall.then(() => rx.DOM[k](...args).toPromise());
  };

  return acc;
}, {});

let isHttpUrl = (pathOrUrl) => pathOrUrl.match(/^https?:\/\//i);

/**
 * Fetches a path as either a file path or a HTTP URL.
 *
 * @param  {string} pathOrUrl   Either an HTTP URL or a file path.
 * @return {string}             The contents as a UTF-8 decoded string.
 */
module.exports.fetchFileOrUrl = async function(pathOrUrl) {
  if (!isHttpUrl(pathOrUrl)) {
    return await fs.readFile(pathOrUrl, 'utf8');
  }

  let ret = await module.exports.get(pathOrUrl);
  return ret.response;
};

/**
 * Downloads a path as either a file path or a HTTP URL to a specific place
 *
 * @param  {string} pathOrUrl   Either an HTTP URL or a file path.
 * @return {string}             The contents as a UTF-8 decoded string.
 */
module.exports.downloadFileOrUrl = async function(pathOrUrl, target) {
  if (!isHttpUrl(pathOrUrl)) {
    try {
      let buf = await fs.readFile(pathOrUrl);
      await fs.writeFile(target, buf);

      return buf.length;
    } catch (e) {
      return rx.Observable.throw(e);
    }
  }

  let response = await window.fetch(pathOrUrl, {
    method: 'GET',
    cache: 'no-store',
    redirect: 'follow'
  });

  let fd = await fs.open(target, 'w');
  let length = 0;
  try {
    let reader = await response.body.getReader();
    let chunk = await reader.read();

    while (!chunk.done) {
      let buf = new Buffer(new Uint8Array(chunk.value));
      await fs.write(fd, buf, 0, buf.length);
      length += buf.length;

      chunk = await reader.read();
    }

    // Write out the last chunk
    if (chunk.value && chunk.value.length > 0) {
      let buf = new Buffer(new Uint8Array(chunk.value));
      await fs.write(fd, buf, 0, buf.length);
      length += buf.length;
    }
  } finally {
    await fs.close(fd);
  }
  
  if (!response.ok) {
    throw new Error(`HTTP request returned error: ${response.status}: ${response.statusText}`);
  }

  return length;
};
