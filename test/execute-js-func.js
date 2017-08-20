import {remote} from 'electron';
import {createProxyForRemote} from '../src/execute-js-func';
import {fromRemoteWindow} from '../src/remote-event';

const {BrowserWindow} = remote;

describe('createProxyForRemote', function() {
  this.timeout(10*1000);

  async function initWindow(proxyTimeout) {
    const bw = new BrowserWindow({width: 500, height: 500, show: false});
    const proxy = createProxyForRemote(bw, proxyTimeout);
    const ready = fromRemoteWindow(bw, 'dom-ready', true).take(1).toPromise();

    bw.loadURL(`file://${__dirname}/fixture/renderer-with-eval-handler.html`);
    await ready;

    return { bw, proxy };
  }

  it('should fail to execute slow method exceeding timeout', async function() {
    const { proxy } = await initWindow(500);

    return proxy.slowMethod().should.be.rejected;
  });

  it('should execute slow method if timeout is large', async function() {
    const { proxy } = await initWindow();

    return proxy.slowMethod().should.be.fulfilled;
  });

  it('should fail to execute nonexistent method', async function () {
    const { proxy } = await initWindow();

    return proxy.a.b().should.be.rejected;
  });
});
