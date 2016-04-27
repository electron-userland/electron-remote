import {rendererRequireDirect} from '../src/renderer-require';

describe('the rendererRequireDirect method', function() {
  this.timeout(10*1000);

  it('makes a request using remote-ajax', async function() {
    let { module, dispose } = await rendererRequireDirect(require.resolve('../src/remote-ajax'));

    try {
      let result = await module.getJSON('https://httpbin.org/get');
      expect(result.url).to.equal('https://httpbin.org/get');
    } finally {
      dispose();
    }
  });

  it('marshals errors correctly', async function() {
    let { module, dispose } = await rendererRequireDirect(require.resolve('../src/remote-ajax'));

    let shouldDie = true;
    try {
      await module.getJSON('https://httpbin.org/status/500');
    } catch (e) {
      shouldDie = false;
    } finally {
      dispose();
    }

    expect(shouldDie).to.equal(false);
  });

  it('marshals simple values via getters', async function() {
    let { module, dispose } = await rendererRequireDirect(require.resolve('./dummy-module'));

    try {
      let result = await module.dummyVal_get();
      expect(result).to.equal(42);
    } finally {
      dispose();
    }
  });

  it('marshals simple functions', async function() {
    let { module, dispose } = await rendererRequireDirect(require.resolve('./dummy-module'));

    try {
      let result = await module.dummyFunc();
      expect(result).to.equal(42);
    } finally {
      dispose();
    }
  });

  it('marshals Buffers', async function() {
    let { module, dispose } = await rendererRequireDirect(require.resolve('./dummy-module'));

    try {
      let result = await module.dummyBuffer();
      expect(result.length).to.equal(8);
      expect(result[0]).to.equal(1);
      expect(result[7]).to.equal(8);
    } finally {
      dispose();
    }
  });
});
