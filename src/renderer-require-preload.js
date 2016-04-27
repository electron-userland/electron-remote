import {initializeEvalHandler} from './execute-js-func';
import url from 'url';

initializeEvalHandler();

url.parse(window.location.href);
let escapedModule = url.parse(window.location.href).query.split('=')[1];
try {
  window.requiredModule = require(decodeURIComponent(escapedModule));
} catch (e) {
  window.moduleLoadFailure = e;
}
