import {remote} from 'electron';
import {fromRemoteWindow} from '../src/remote-event';

const {BrowserWindow} = remote;

describe('fromRemoteWindow', function() {
  this.timeout(10*1000);
  
  it.only('should get the did-finish-load event', async function() {
    let bw = new BrowserWindow({width: 500, height: 500, show: false});
    
    let finished = fromRemoteWindow(bw, 'did-finish-load').take(1).toPromise();
    bw.loadURL('https://www.google.com');
    
    await finished;
  });
});
