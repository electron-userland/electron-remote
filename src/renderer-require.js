import path from 'path';
import {fromRemoteWindow} from './remote-event';

import {AsyncSubject} from 'rxjs/AsyncSubject';
import {Observable} from 'rxjs/Observable';
import {Subject} from 'rxjs/Subject';

import 'rxjs/add/observable/merge';
import 'rxjs/add/observable/throw';
import 'rxjs/add/observable/fromPromise';
import 'rxjs/add/observable/of';
import 'rxjs/add/observable/defer';

import 'rxjs/add/operator/map';
import 'rxjs/add/operator/mergeAll';
import 'rxjs/add/operator/mergeMap';
import 'rxjs/add/operator/multicast';
import 'rxjs/add/operator/take';
import 'rxjs/add/operator/toPromise';

import {createProxyForRemote, executeJavaScriptMethod, executeJavaScriptMethodObservable, RecursiveProxyHandler} from './execute-js-func';

import './custom-operators';

const d = require('debug')('electron-remote:renderer-require');

const BrowserWindow = process.type === 'renderer' ?
  require('electron').remote.BrowserWindow :
  require('electron').BrowserWindow;

/**
 * Creates a BrowserWindow, requires a module in it, then returns a Proxy
 * object that will call into it. You probably want to use {requireTaskPool}
 * instead.
 *
 * @param  {string} modulePath  The path of the module to include.
 * @param  {number} timeout     The timeout to use, defaults to 240sec
 * @return {Object}             Returns an Object with a `module` which is a Proxy
 *                              object, and a `unsubscribe` method that will clean up
 *                              the window.
 */
export async function rendererRequireDirect(modulePath, timeout=240*1000) {
  let bw = new BrowserWindow({width: 500, height: 500, show: false});
  let fullPath = modulePath;

  let ready = Observable.merge(
    fromRemoteWindow(bw, 'did-finish-load', true),
    fromRemoteWindow(bw, 'did-fail-load', true)
      .filter(([, errCode]) => errCode !== 0)
      .mergeMap(([, , errMsg]) => Observable.throw(new Error(errMsg)))
    ).take(1).toPromise();

  /* Uncomment for debugging!
  bw.show();
  bw.openDevTools();
  */

  let preloadFile = path.join(__dirname, 'renderer-require-preload.html');
  bw.loadURL(`file:///${preloadFile}?module=${encodeURIComponent(fullPath)}`);
  await ready;

  let fail = await executeJavaScriptMethod(bw, 'window.moduleLoadFailure');
  if (fail) {
    let msg = await executeJavaScriptMethod(bw, 'window.moduleLoadFailure.message');
    throw new Error(msg);
  }

  return {
    module: createProxyForRemote(bw).requiredModule,
    executeJavaScriptMethod: (chain, ...args) => executeJavaScriptMethodObservable(bw, timeout, chain, ...args).toPromise(),
    executeJavaScriptMethodObservable: (chain, ...args) => executeJavaScriptMethodObservable(bw, timeout, chain, ...args),
    unsubscribe: () => bw.isDestroyed() ? bw.destroy() : bw.close()
  };
}

/**
 * requires a module in BrowserWindows that are created/destroyed as-needed, and
 * returns a Proxy object that will secretly marshal invocations to other processes
 * and marshal back the result. This is the cool method in this library.
 *
 * Note that since the global context is created / destroyed, you *cannot* rely
 * on module state (i.e. global variables) to be consistent
 *
 * @param  {string} modulePath       The path to the module. You may have to
 *                                   `require.resolve` it.
 * @param  {Number} maxConcurrency   The maximum number of concurrent processes
 *                                   to run. Defaults to 4.
 * @param  {Number} idleTimeout      The amount of time to wait before closing
 *                                   a BrowserWindow as idle, in ms
 * @param  {Number} methodTimeout    The amount of time to wait before a method
 *                                   fails, in ms
 *
 * @return {Proxy}                   An ES6 Proxy object representing the module.
 */
export function requireTaskPool(modulePath, maxConcurrency=4, idleTimeout=5*1000, methodTimeout=240*1000) {
  return new RendererTaskpoolItem(modulePath, maxConcurrency, idleTimeout, methodTimeout).moduleProxy;
}

/**
 * This class implements the scheduling logic for queuing and dispatching method
 * invocations to various background windows. It is complicated. But in like,
 * a cool way.
 */
class RendererTaskpoolItem {
  constructor(modulePath, maxConcurrency, idleTimeout, methodTimeout) {
    const freeWindowList = [];
    const invocationQueue = new Subject();
    const completionQueue = new Subject();

    // This method will find a window that is currently idle or if it doesn't
    // exist, create one.
    const getOrCreateWindow = () => {
      let item = freeWindowList.pop();
      if (item) return Observable.of(item);

      return Observable.fromPromise(rendererRequireDirect(modulePath, methodTimeout));
    };

    // Here, we set up a pipeline that maps a stream of invocations (i.e.
    // something we can pass to executeJavaScriptMethod) => stream of Future
    // Results from various windows => Stream of completed results, for which we
    // throw the Window that completed the result back onto the free window stack.
    invocationQueue
      .map(({chain, args, retval}) => Observable.defer(() => {
        return getOrCreateWindow()
          .mergeMap((wnd) => {
            d(`Actually invoking ${chain.join('.')}(${JSON.stringify(args)})`);
            let ret = wnd.executeJavaScriptMethodObservable(chain, ...args);

            ret.multicast(retval).connect();
            return ret.map(() => wnd).catch(() => Observable.of(wnd));
          });
      }))
      .mergeAll(maxConcurrency)
      .subscribe((wnd) => {
        if (!wnd || !wnd.unsubscribe) throw new Error("Bogus!");
        freeWindowList.push(wnd);
        completionQueue.next(true);
      });

    // Here, we create a version of RecursiveProxyHandler that will turn method
    // invocations into something we can push onto our invocationQueue pipeline.
    // This is the object that ends up being returned to the caller of
    // requireTaskPool.
    this.moduleProxy = RecursiveProxyHandler.create('__removeme__', (methodChain, args) => {
      let chain = methodChain.splice(1);

      d(`Queuing ${chain.join('.')}(${JSON.stringify(args)})`);
      let retval = new AsyncSubject();

      invocationQueue.next({ chain: ['requiredModule'].concat(chain), args, retval });
      return retval.toPromise();
    });

    // If we haven't received any invocations within a certain idle timeout
    // period, burn all of our BrowserWindow instances
    completionQueue.guaranteedThrottle(idleTimeout).subscribe(() => {
      d(`Freeing ${freeWindowList.length} taskpool processes`);
      while (freeWindowList.length > 0) {
        let wnd = freeWindowList.pop();
        if (wnd) wnd.unsubscribe();
      }
    });
  }
}
