import {Observable} from 'rxjs/Observable';
import {Subscription} from 'rxjs/Subscription';

import 'rxjs/add/observable/of';
import 'rxjs/add/observable/throw';

import 'rxjs/add/operator/catch';
import 'rxjs/add/operator/do';
import 'rxjs/add/operator/filter';
import 'rxjs/add/operator/take';
import 'rxjs/add/operator/mergeMap';
import 'rxjs/add/operator/timeout';
import 'rxjs/add/operator/toPromise';

const requestChannel = 'execute-javascript-request';
const responseChannel = 'execute-javascript-response';

let isBrowser = (process.type === 'browser');
let ipc = require('electron')[isBrowser ? 'ipcMain' : 'ipcRenderer'];

const d = require('debug-electron')('electron-remote:execute-js-func');
const BrowserWindow = isBrowser ?
  require('electron').BrowserWindow :
  require('electron').remote.BrowserWindow;

let nextId = 1;
function getNextId() {
  return (process.pid << 32) | (nextId++);
}

/**
 * Determines the identifier for the current process (i.e. the thing we can use
 * to route messages to it)
 *
 * @return {object} An object with either a `guestInstanceId` or a `browserWindowId`
 */
export function getSenderIdentifier() {
  if (isBrowser) return {};

  if (process.guestInstanceId) {
    return { guestInstanceId: process.guestInstanceId };
  }

  return {
    browserWindowId: require('electron').remote.getCurrentWindow().id
  };
}

/**
 * Determines a way to send a reply back from an incoming eval request.
 *
 * @param  {Object} request   An object returned from {getSenderIdentifier}
 *
 * @return {Function}         A function that act like ipc.send, but to a
 *                            particular process.
 *
 * @private
 */
function getReplyMethod(request) {
  let target = findTargetFromParentInfo(request);

  if (target) {
    return (...a) => target.send(...a);
  } else {
    d("Using reply to main process");
    return (...a) => ipc.send(...a);
  }
}

/**
 * Turns an IPC channel into an Observable
 *
 * @param  {String} channel     The IPC channel to listen to via `ipc.on`
 *
 * @return {Observable<Array>}  An Observable which sends IPC args via `onNext`
 *
 * @private
 */
function listenToIpc(channel) {
  return Observable.create((subj) => {
    let listener = (event, ...args) => {
      d(`Got an event for ${channel}: ${JSON.stringify(args)}`);
      subj.next(args);
    };

    d(`Setting up listener! ${channel}`);
    ipc.on(channel, listener);

    return new Subscription(() =>
      ipc.removeListener(channel, listener));
  });
}

/**
 * Returns a method that will act like `ipc.send` depending on the parameter
 * passed to it, so you don't have to check for `webContents`.
 *
 * @param  {BrowserWindow|WebView} windowOrWebView    The renderer to send to.
 *
 * @return {Function}                                 A function that behaves like
 *                                                    `ipc.send`.
 *
 * @private
 */
function getSendMethod(windowOrWebView) {
  if (!windowOrWebView) return (...a) => ipc.send(...a);

  return ('webContents' in windowOrWebView) ?
    (...a) => {
      d(`webContents send: ${JSON.stringify(a)}`);
      windowOrWebView.webContents.send(...a);
    } :
    (...a) => {
      d(`webView send: ${JSON.stringify(a)}`);
      windowOrWebView.send(...a);
    };
}

/**
 * This method creates an Observable Promise that represents a future response
 * to a remoted call. It filters on ID, then cancels itself once either a
 * response is returned, or it times out.
 *
 * @param  {BrowserWindow|WebView} windowOrWebView    A renderer process
 * @param  {Guid} id                                  The ID of the sent request
 * @param  {Number} timeout                           The timeout in milliseconds
 *
 * @return {Observable}                               An Observable Promise
 *                                                    representing the result, or
 *                                                    an OnError with the error.
 *
 * @private
 */
function listenerForId(windowOrWebView, id, timeout) {
  return listenToIpc(responseChannel)
    .do(([x]) => d(`Got IPC! ${x.id} === ${id}; ${JSON.stringify(x)}`))
    .filter(([receive]) => receive.id === id && id)
    .take(1)
    .mergeMap(([receive]) => {
      if (receive.error) {
        let e = new Error(receive.error.message);
        e.stack = receive.error.stack;
        return Observable.throw(e);
      }

      return Observable.of(receive.result);
    })
    .timeout(timeout);
}


/**
 * Given the parentInfo returned from {getSenderIdentifier}, returns the actual
 * BrowserWindow or WebContents that it represents.
 *
 * @param  {object} parentInfo            The renderer process identifying info.
 *
 * @return {BrowserWindow|WebContents}    An actual Renderer Process object.
 *
 * @private
 */
function findTargetFromParentInfo(parentInfo=window.parentInfo) {
  if (!parentInfo) return null;
  if ('guestInstanceId' in parentInfo) {
    return require('electron').remote.getGuestWebContents(parentInfo.guestInstanceId);
  }

  if ('browserWindowId' in parentInfo) {
    return BrowserWindow.fromId(parentInfo.browserWindowId);
  }

  return null;
}

/**
 * Configures a child renderer process who to send replies to. Call this method
 * when you want child windows to be able to use their parent as an implicit
 * target.
 *
 * @param {BrowserWindow|WebView} windowOrWebView   The child to configure
 */
export function setParentInformation(windowOrWebView) {
  let info = getSenderIdentifier();
  let ret;

  if (info.guestInstanceId) {
    ret = remoteEval(windowOrWebView, `window.parentInfo = { guestInstanceId: ${info.guestInstanceId} }`);
  } else if (info.browserWindowId) {
    ret = remoteEval(windowOrWebView, `window.parentInfo = { browserWindowId: ${info.browserWindowId} }`);
  } else {
    ret = remoteEval(windowOrWebView, `window.parentInfo = {}`);
  }

  return ret.catch((err) => d(`Unable to set parentInfo: ${err.stack || err.message}`));
}

/**
 * Evaluates a string `eval`-style in a remote renderer process.
 *
 * @param {BrowserWindow|WebView} windowOrWebView   The child to execute code in.
 * @param  {string} str                             The code to execute.
 * @param  {Number} timeout                         The timeout in milliseconds
 *
 * @return {Observable}                             The result of the evaluation.
 *                                                  Must be JSON-serializable.
 */
export function remoteEvalObservable(windowOrWebView, str, timeout=5*1000) {
  let send = getSendMethod(windowOrWebView || findTargetFromParentInfo());
  if (!send) {
    return Observable.throw(new Error(`Unable to find a target for: ${JSON.stringify(window.parentInfo)}`));
  }

  if (!str || str.length < 1) {
    return Observable.throw(new Error("RemoteEval called with empty or null code"));
  }

  let toSend = Object.assign({ id: getNextId(), eval: str }, getSenderIdentifier());
  let ret = listenerForId(windowOrWebView, toSend.id, timeout);

  d(`Sending: ${JSON.stringify(toSend)}`);
  send(requestChannel, toSend);
  return ret;
}

/**
 * Evaluates a string `eval`-style in a remote renderer process.
 *
 * @param {BrowserWindow|WebView} windowOrWebView   The child to execute code in.
 * @param  {string} str                             The code to execute.
 * @param  {Number} timeout                         The timeout in milliseconds
 *
 * @return {Promise}                             The result of the evaluation.
 *                                               Must be JSON-serializable.
 */
export function remoteEval(windowOrWebView, str, timeout=5*1000) {
  return remoteEvalObservable(windowOrWebView, str, timeout).toPromise();
}

/**
 * Evaluates a JavaScript method on a remote object and returns the result. this
 * method can be used to either execute Functions in remote renderers, or return
 * values from objects. For example:
 *
 * let userAgent = await executeJavaScriptMethod(wnd, 'navigator.userAgent');
 *
 * executeJavaScriptMethod will also be smart enough to recognize when methods
 * themselves return Promises and await them:
 *
 * let fetchResult = await executeJavaScriptMethod('window.fetchHtml', 'https://google.com');
 *
 * @param {BrowserWindow|WebView} windowOrWebView   The child to execute code
 *                                                  in. If this parameter is
 *                                                  null, this will reference
 *                                                  the browser process.
 * @param  {Number} timeout         Timeout in milliseconds
 * @param  {string} pathToObject    A path to the object to execute, in dotted
 *                                  form i.e. 'document.querySelector'.
 * @param  {Array} args             The arguments to pass to the method
 *
 * @return {Observable}                The result of evaluating the method or
 *                                     property. Must be JSON serializable.
 */
export function executeJavaScriptMethodObservable(windowOrWebView, timeout, pathToObject, ...args) {
  let send = getSendMethod(windowOrWebView || findTargetFromParentInfo());
  if (!send) {
    return Observable.throw(new Error(`Unable to find a target for: ${JSON.stringify(window.parentInfo)}`));
  }

  if (Array.isArray(pathToObject)) {
    pathToObject = pathToObject.join('.');
  }

  if (!pathToObject.match(/^[a-zA-Z0-9\._]+$/)) {
    return Observable.throw(new Error(`pathToObject must be of the form foo.bar.baz (got ${pathToObject})`));
  }

  let toSend = Object.assign({ args, id: getNextId(), path: pathToObject }, getSenderIdentifier());
  let ret = listenerForId(windowOrWebView, toSend.id, timeout);

  d(`Sending: ${JSON.stringify(toSend)}`);
  send(requestChannel, toSend);
  return ret;
}


/**
 * Evaluates a JavaScript method on a remote object and returns the result. this
 * method can be used to either execute Functions in remote renderers, or return
 * values from objects. For example:
 *
 * let userAgent = await executeJavaScriptMethod(wnd, 'navigator.userAgent');
 *
 * executeJavaScriptMethod will also be smart enough to recognize when methods
 * themselves return Promises and await them:
 *
 * let fetchResult = await executeJavaScriptMethod('window.fetchHtml', 'https://google.com');
 *
 * @param {BrowserWindow|WebView} windowOrWebView   The child to execute code
 *                                                  in. If this parameter is
 *                                                  null, this will reference
 *                                                  the browser process.
 * @param  {string} pathToObject    A path to the object to execute, in dotted
 *                                  form i.e. 'document.querySelector'.
 * @param  {Array} args             The arguments to pass to the method
 *
 * @return {Promise}                The result of evaluating the method or
 *                                  property. Must be JSON serializable.
 */
export function executeJavaScriptMethod(windowOrWebView, pathToObject, ...args) {
  return executeJavaScriptMethodObservable(windowOrWebView, 5*1000, pathToObject, ...args).toPromise();
}

/**
 * Creates an object that is a representation of the remote process's 'window'
 * object that allows you to remotely invoke methods.
 *
 * @param {BrowserWindow|WebView} windowOrWebView   The child to execute code
 *                                                  in. If this parameter is
 *                                                  null, this will reference
 *                                                  the browser process.
 *
 * @return {Object}     A Proxy object that will invoke methods remotely.
 *                      Similar to {executeJavaScriptMethod}, methods will return
 *                      a Promise even if the target method returns a normal
 *                      value.
 */
export function createProxyForRemote(windowOrWebView) {
  return RecursiveProxyHandler.create('__removeme__', (methodChain, args) => {
    let chain = methodChain.splice(1);

    d(`Invoking ${chain.join('.')}(${JSON.stringify(args)})`);
    return executeJavaScriptMethod(windowOrWebView, chain, ...args);
  });
}

/**
 * Walks the global object hierarchy to resolve the actual object that a dotted
 * object path refers to.
 *
 * @param  {string} path  A path to the object to execute, in dotted
 *                        form i.e. 'document.querySelector'.
 *
 * @return {Array<string>}      Returns the actual method object and its parent,
 *                              usually a Function and its `this` parameter, as
 *                              `[parent, obj]`
 *
 * @private
 */
function objectAndParentGivenPath(path) {
  let obj = global || window;
  let parent = obj;

  for (let part of path.split('.')) {
    parent = obj;
    obj = obj[part];
  }

  d(`parent: ${parent}, obj: ${obj}`);
  if (typeof(parent) !== 'object') {
    throw new Error(`Couldn't access part of the object window.${path}`);
  }

  return [parent, obj];
}

/**
 * Given an object path and arguments, actually invokes the method  and returns
 * the result. This method is run on the target side (i.e. not the one doing
 * the invoking). This method tries to figure out the return value of an object
 * and do the right thing, including awaiting Promises to get their values.
 *
 * @param  {string} path  A path to the object to execute, in dotted
 *                        form i.e. 'document.querySelector'.
 * @param  {Array}  args  The arguments to pass to the method
 *
 * @return {Promise<object>}      The result of evaluating path(...args)
 *
 * @private
 */
async function evalRemoteMethod(path, args) {
  let [parent, obj] = objectAndParentGivenPath(path);

  let result = obj;
  if (obj && typeof(obj) === 'function') {
    d("obj is function!");
    let res = obj.apply(parent, args);

    result = res;
    if (typeof(res) === 'object' && res && 'then' in res) {
      d("result is Promise!");
      result = await res;
    }
  }

  return result;
}

/**
 * Initializes the IPC listener that {executeJavaScriptMethod} will send IPC
 * messages to. You need to call this method in any process that you want to
 * execute remote methods on.
 *
 * @return {Subscription}   An object that you can call `unsubscribe` on to clean up
 *                          the listener early. Usually not necessary.
 */
export function initializeEvalHandler() {
  let listener = async function(e, receive) {
    d(`Got Message! ${JSON.stringify(receive)}`);
    let send = getReplyMethod(receive);

    try {
      if (receive.eval) {
        receive.result = eval(receive.eval);
      } else {
        receive.result = await evalRemoteMethod(receive.path, receive.args);
      }

      d(`Replying! ${JSON.stringify(receive)} - ID is ${e.sender}`);
      send(responseChannel, receive);
    } catch(err) {
      receive.error = {
        message: err.message,
        stack: err.stack
      };

      d(`Failed! ${JSON.stringify(receive)}`);
      send(responseChannel, receive);
    }
  };

  d("Set up listener!");
  ipc.on('execute-javascript-request', listener);

  return new Subscription(() => ipc.removeListener('execute-javascript-request', listener));
}

const emptyFn = function() {};

/**
 * RecursiveProxyHandler is a ES6 Proxy Handler object that intercepts method
 * invocations and returns the full object that was invoked. So this means, if you
 * get a proxy, then execute `foo.bar.bamf(5)`, you'll recieve a callback with
 * the parameters "foo.bar.bamf" as a string, and [5].
 */
export class RecursiveProxyHandler {
  /**
   * Creates a new RecursiveProxyHandler. Don't use this, use `create`
   *
   * @private
   */
  constructor(name, methodHandler, parent=null, overrides=null) {
    this.name = name;
    this.proxies = {};
    this.methodHandler = methodHandler;
    this.parent = parent;
    this.overrides = overrides;
  }

  /**
   * Creates an ES6 Proxy which is handled by RecursiveProxyHandler.
   *
   * @param  {string} name             The root object name
   * @param  {Function} methodHandler  The Function to handle method invocations -
   *                                   this method will receive an Array<String> of
   *                                   object names which will point to the Function
   *                                   on the Proxy being invoked.
   *
   * @param  {Object} overrides        An optional object that lets you directly
   *                                   include functions on the top-level object, its
   *                                   keys are key names for the property, and
   *                                   the values are what the key on the property
   *                                   should return.
   *
   * @return {Proxy}                   An ES6 Proxy object that uses
   *                                   RecursiveProxyHandler.
   */
  static create(name, methodHandler, overrides=null) {
    return new Proxy(emptyFn, new RecursiveProxyHandler(name, methodHandler, null, overrides));
  }

  /**
   * The {get} ES6 Proxy handler.
   *
   * @private
   */
  get(target, prop) {
    if (this.overrides && prop in this.overrides) {
      return this.overrides[prop];
    }

    return new Proxy(emptyFn, this.getOrCreateProxyHandler(prop));
  }

  /**
   * The {apply} ES6 Proxy handler.
   *
   * @private
   */
  apply(target, thisArg, argList) {
    let methodChain = [this.replaceGetterWithName(this.name)];
    let iter = this.parent;

    while (iter) {
      methodChain.unshift(iter.name);
      iter = iter.parent;
    }

    return this.methodHandler(methodChain, argList);
  }

  /**
   * Creates a proxy for a returned `get` call.
   *
   * @param  {string} name  The property name
   * @return {RecursiveProxyHandler}
   *
   * @private
   */
  getOrCreateProxyHandler(name) {
    let ret = this.proxies[name];
    if (ret) return ret;

    ret = new RecursiveProxyHandler(name, this.methodHandler, this);
    this.proxies[name] = ret;
    return ret;
  }

  /**
   * Because we don't support directly getting values by-name, we convert any
   * call of the form "getXyz" into a call for the value 'xyz'
   *
   * @return {string} The name of the actual method or property to evaluate.
   * @private
   */
  replaceGetterWithName(name) {
    return name.replace(/_get$/, '');
  }
}
