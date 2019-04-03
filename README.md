# DEPRECATED: electron-remote: an asynchronous 'remote', and more

[![No Maintenance Intended](http://unmaintained.tech/badge.svg)](http://unmaintained.tech/)

This project is no longer maintained, pull requests are no longer being reviewed or merged and issues are no longer being responded to. 

---

![](https://img.shields.io/npm/dm/electron-remote.svg) <a href="http://paulcbetts.github.io/electron-remote/docs">![](http://paulcbetts.github.io/electron-remote/docs/badge.svg)</a>


electron-remote provides an alternative to Electron's `remote` module based around Promises instead of synchronous execution. It also provides an automatic way to use BrowserWindows as "background processes" that auto-scales based on usage, similar to Grand Central Dispatch or the .NET TPL Taskpool.

## The Quickest of Quick Starts

###### Calling main process modules from a renderer

```js
import { createProxyForMainProcessModule } from 'electron-remote';

// app is now a proxy for the app module in the main process
const app = createProxyForMainProcessModule('app');

// The difference is all methods return a Promise instead of blocking
const memoryInfo = await app.getAppMemoryInfo();
```

###### Calling code in other windows

```js
import { createProxyForRemote } from 'electron-remote';

// myWindowJs is now a proxy object for myWindow's `window` global object
const myWindowJs = createProxyForRemote(myWindow);

// Functions suffixed with _get will read a value
userAgent = await myWindowJs.navigator.userAgent_get()
```

###### Renderer Taskpool

```js
import { requireTaskPool } from 'electron-remote';

const myCoolModule = requireTaskPool(require.resolve('./my-cool-module'));

// This method will run synchronously, but in a background BrowserWindow process
// so that your app will not block
let result = await myCoolModule.calculateDigitsOfPi(100000);
```

## But I like Remote!

Remote is super convenient! But it also has some downsides - its main downside is that its action is **synchronous**. This means that both the main and window processes will _wait_ for a method to finish running. Even for quick methods, calling it too often can introduce scroll jank and generally cause performance problems.

electron-remote is a version of remote that, while less ergonomic, guarantees that it won't block the calling thread.

## Using createProxyForRemote

`createProxyForRemote` is a replacement for places where you would use Electron's `executeJavaScript` method on BrowserWindow or WebView instances - however, it works a little differently. Using a new feature in ES2015 called [proxy objects](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy), we create an object which represents the `window` object on a remote context, and all method calls get sent as messages to that remote instead of being run immediately, which feels very similar to the `remote` Electron module.

This provides a number of very important advantages:

* `createProxyForRemote` uses asynchronous IPC instead of blocking
* Parameters are serialized directly, so you don't have to try to build strings that can be `eval`d, which is a dangerous endeavor at best.
* Calling methods on objects is far more convenient than trying to poke at things via a remote eval.

#### How do I get properties if everything is a Promise tho???

Astute observers will note, that getting the value of a property is always a synchronous operation - to facilitate that, any method with `_get()` appended to it will let you fetch the value for the property.

```js
import { createProxyForRemote } from 'electron-remote';

// myWindowJs is now a proxy object for myWindow's `window` global object
const myWindowJs = createProxyForRemote(myWindow);

// Functions suffixed with _get will read a value
myWindowJs.navigator.userAgent_get()
  .then((agent) => console.log(`The user agent is ${agent}`));
```

#### But do this first!

Before you use `createProxyForRemote`, you **must** call `initializeEvalHandler()` in the target window on startup. This sets up the listeners that electron-remote will use.

#### Bringing it all together

```js
// In my window's main.js
initializeEvalHandler();
window.addNumbers = (a,b) => a + b;


// In my main process
let myWindowProxy = createProxyForRemote(myWindow);
myWindowProxy.addNumbers(5, 5)
  .then((x) => console.log(x));

>>> 10
```

#### Using createProxyForMainProcessModule
This is meant to be a drop-in replacement for places you would have used `remote` in a renderer process. It's almost identical to `createProxyForRemote`, but instead of `eval`ing JavaScript it can only call methods on main process modules. It still has all the same benefits: asynchronous IPC instead of an `ipc.sendSync`.

## Here Be Dragons

electron-remote has a number of significant caveats versus the remote module that you should definitely be aware of:

* Remote values must be Serializable

Objects that you return to the calling process must be serializable (i.e. you can call `JSON.stringify` on it and get a valid thing)- this means that creating Classes won't work, nor will return objects like BrowserWindows or other Electron objects. For example:

```js
let myWindowProxy = createProxyForRemote(myWindow);

// XXX: BAD - HTML elements aren't serializable
let obj = myWindowProxy.document.createElement('h1');
```

* Remote event listeners aren't supported

Anything that involves an event handler isn't going to work:

```js
// XXX: BAD - You can't add event handlers
myWindowProxy.document.addEventListener('onBlur', (e) => console.log("Blur!"));
```

## The Renderer Taskpool

Renderer Taskpools provide an automatic way to use BrowserWindows as "background processes" that auto-scales based on usage, similar to Grand Central Dispatch or the .NET TPL Taskpool. This works by allowing you to provide a Module that you'd like to load in the remote processes, which will be loaded and unloaded on the fly according to demand.

Let's look at the example again:

```js
import { requireTaskPool } from 'electron-remote';

const myCoolModule = requireTaskPool(require.resolve('./my-cool-module'));

// This method will run synchronously, but in a background BrowserWindow process
// so that your app will not block
let result = await myCoolModule.calculateDigitsOfPi(100000);
```

By default, `requireTaskPool` will create up to four background processes to concurrently run JS code on. As these processes become busy, requests will be queued to different processes and wait in line implicitly.

##### More Dragons

Since `requireTaskPool` will create and destroy processes as needed, this means that global variables or other state will be destroyed as well. You can't rely on setting a global variable and having it persist for a period of time longer than one method call.

## The remote-ajax module

One module that is super useful to have from the main process is a way to make network requests using Chromium's networking stack, which correctly does things such as respecting the system proxy settings. To this end, electron-remote comes with a convenient wrapper around Rx-DOM's AJAX methods called `remote-ajax`.

```js
import { requireTaskPool } from 'electron-remote';

const remoteAjax = requireTaskPool(require.resolve('electron-remote/remote-ajax'));

// Result is the object that XmlHttpRequest gives you
let result = await remoteAjax.get('https://httpbin.org/get');
console.log(result.url)

>>> 'https://httpbin.org/get'
```

See the documentation for [Rx-DOM](https://github.com/Reactive-Extensions/RxJS-DOM/blob/master/modules/main-ajax/readme.md) for how these methods work.

Another method that is included is `downloadFileOrUrl`, which lets you download a file to a target:

```js
/**
 * Downloads a path as either a file path or a HTTP URL to a specific place
 *
 * @param  {string} pathOrUrl   Either an HTTP URL or a file path.
 * @return {string}             The contents as a UTF-8 decoded string.
 */
function downloadFileOrUrl(pathOrUrl, target)
```
