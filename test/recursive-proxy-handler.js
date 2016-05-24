import {RecursiveProxyHandler} from '../src/execute-js-func';

describe('RecursiveProxyHandler', function() {
  it('should let me apply a function', function() {
    var proxy = RecursiveProxyHandler.create('proxy', (names, args) => {
      console.log(`${JSON.stringify(names)} - ${JSON.stringify(args)}`);
    });

    let baz = proxy.foo.bar.baz(1,2,3);
  });

  it('tests ES6 proxies', function() {
    let createHandler = () => {
      return {
        get: function(target, prop) {
          console.log('Get!');
          return new Proxy(function() {}, createHandler());
        },

        apply: function(target, thisArg, argList) {
          console.log("Apply!");
          console.log(JSON.stringify(argList));
        }
      }
    };

    var foo = new Proxy({}, createHandler());
    foo.bar.baz(1,2,3,4);
  });
});
