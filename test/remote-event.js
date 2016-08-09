import {remote} from 'electron';
import {fromRemoteWindow} from '../src/remote-event';

const {BrowserWindow} = remote;

describe.only('fromRemoteWindow', function() {
  this.timeout(10*1000);
  
  it('should get the ready-to-show event', async function() {
    let bw = new BrowserWindow({width: 500, height: 500, show: false});
    
    let finished = fromRemoteWindow(bw, 'ready-to-show').take(1).toPromise();
    bw.loadURL('https://www.google.com');
    
    await finished;
    
    bw.close();
  });
  
  it('should get the dom-ready event', async function() {
    let bw = new BrowserWindow({width: 500, height: 500, show: false});
    
    let finished = fromRemoteWindow(bw, 'dom-ready', true).take(1).toPromise();
    bw.loadURL('https://www.google.com');
    
    await finished;
    bw.close();
  });
});
