import * as executeJsFunc from './execute-js-func';
import * as rendererRequire from './renderer-require';
import * as remoteEvent from './remote-event';

const executeJsFuncExports = [
  'createProxyForRemote',
  'getSenderIdentifier', 
  'executeJavaScriptMethodObservable',
  'executeJavaScriptMethod',
  'initializeEvalHandler',
  'remoteEvalObservable', 
  'remoteEval',
  'setParentInformation', 
  'RecursiveProxyHandler'
];

module.exports = Object.assign(
  executeJsFuncExports.reduce((acc, x) => { acc[x] = executeJsFunc[x]; return acc; }, {}),
  rendererRequire,
  remoteEvent
);
