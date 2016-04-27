import * as executeJsFunc from './execute-js-func';
import * as remoteAjax from './remote-ajax';
import * as rendererRequire from './rendererRequire';

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
  { remoteAjax: remoteAjax },
  rendererRequire
);
