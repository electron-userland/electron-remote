# electron-remote: an asynchronous 'remote', and more

electron-remote provides an alternative to Electron's `remote` module based around Promises instead of synchronous execution. It also provides an automatic way to use BrowserWindows as "background processes" that auto-scales based on usage, similar to Grand Central Dispatch or the .NET TPL Taskpool.

## The Quickest of Quick Starts

```js
import { requireTaskPool } from 'electron-remote';

const myCoolModule = requireTaskPool(require.resolve('./my-cool-module'));

// This method will run synchronously, but in a background BrowserWindow process
// so that your app will not block
let result = await myCoolModule.calculateDigitsOfPi(100000);
```

```js
import { createProxyForRemote } from 'electron-remote';

// myWindowJs is now a proxy object for myWindow's `window` global object
const myWindowJs = createProxyForRemote(myWindow);

// Functions suffixed with _get will read a value
userAgent = await myWindowJs.navigator.userAgent_get()
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
