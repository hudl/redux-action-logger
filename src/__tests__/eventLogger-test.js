'use strict';

require('isomorphic-fetch'); // poly-fill fetch for node

import { createActionLogger } from '../index.js';
import nock from 'nock';

const originalConsole = console;
const _suppressConsole = function(shouldSuppress) {
  if (shouldSuppress) {
    console = {}; // eslint-disable-line
    console.log = console.warn = console.error = console.err = console.fatal = ()=> null; // eslint-disable-line
  } else {
    console = originalConsole; // eslint-disable-line
  }
};

const sleep = function(timeout) {
  return new Promise((resolve) => {
    setTimeout(resolve, timeout);
  });
};

const localStorageMock = (function() {
  let store = {};
  return {
    getItem: function(key) {
      return store[key];
    },
    setItem: function(key, value) {
      store[key] = value.toString();
    },
    removeItem: function(key, value) {
      delete store[key];
    },
    clear: function() {
      store = {};
    },
    _dumpStore: function() {
      return store;
    },
    _queueLength: function(name) {
      const queue = store[name + '--queue'];
      if (!queue) return 0;
      return store[name + '--queue'].split('|').length;
    },
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

const dummyDomain = 'http://dummy-endpoint.com';
const dummyPath = '/logging';
const dummyEndpoint = {
  uri: dummyDomain + dummyPath,
};

const dummyStore = {
  getState: jest.fn(()=>{
    return {
      userId: 12345,
      teamId: 45678,
      dataPoint: 'test',
    };
  }),
};


describe('createActionLogger initialization', () => {
  test('attempt to createActionLogger with invalid inputs', async () => {
    expect(() => createActionLogger({ name: null, actionHandlers: () => {} })).toThrow(/name/);
    expect(() => createActionLogger({ name: '', actionHandlers: () => {} })).toThrow(/name/);
    expect(() => createActionLogger({ name: 123, actionHandlers: () => {} })).toThrow(/name/);
    
    expect(() => createActionLogger({ name: 'foo' })).toThrow(/actionHandlers/);
    expect(() => createActionLogger({ name: 'foo', actionHandlers: [] })).toThrow(/actionHandlers/);
    expect(() => createActionLogger({ name: 'foo', actionHandlers: [null] })).toThrow(/actionHandlers/);
    expect(() => createActionLogger({ name: 'foo', actionHandlers: ['foo'] })).toThrow(/actionHandlers/);
    expect(() => createActionLogger({ name: 'foo', actionHandlers: 123 })).toThrow(/actionHandlers/);
    expect(() => createActionLogger({ name: 'foo', actionHandlers: [() => {}, 'foo'] })).toThrow(/actionHandlers/);

    expect(() => createActionLogger({
      name: 'foo',
      actionHandlers: () => {},
      logValidator: 'foobar',
    })).toThrow(/logValidator/);
    expect(() => createActionLogger({
      name: 'foo',
      actionHandlers: () => {},
    })).toThrow(/endpoint/);
    expect(() => createActionLogger({
      name: 'foo',
      actionHandlers: () => {},
      endpoint: { }
    })).toThrow(/endpoint/);
    expect(() => createActionLogger({
      name: 'foo',
      actionHandlers: () => {},
      endpoint: {
        uri: 12345,
      }
    })).toThrow(/endpoint/);
    expect(() => createActionLogger({
      name: 'foo',
      actionHandlers: () => {},
      endpoint: {
        uri: ()=>'test',
      }
    })).toThrow(/endpoint/);
  });

  test('single-actionHandler happy path', async () => {
    const dummyHandler = jest.fn();
    const middleware = createActionLogger({
      name: 'test',
      actionHandlers: dummyHandler,
      endpoint: dummyEndpoint,
    });
    expect(typeof middleware).toEqual('function');
    expect(dummyHandler).toHaveBeenCalledTimes(0);
  });
  test('array of actionHandlers happy path', async () => {
    const dummyHandler = jest.fn();
    const middleware = createActionLogger({
      name: 'test',
      actionHandlers: [ dummyHandler, dummyHandler ],
      endpoint: dummyEndpoint,
    });
    expect(typeof middleware).toEqual('function');
    expect(dummyHandler).toHaveBeenCalledTimes(0);
  });
});

describe('createActionLogger middleware tests', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });
  beforeEach(() => {
    localStorageMock.clear();
    nock.cleanAll();
  });

  test('middleware skips blank action handlers', async () => {
    const evtVal = jest.fn();
    const blankActionHandler = jest.fn(()=>null);
    const loggerName = 'test';
    const middleware = createActionLogger({
      name: loggerName,
      actionHandlers: [ blankActionHandler ],
      endpoint: dummyEndpoint,
      logValidator: evtVal,
    });
    const action = {
      type: 'test-type',
    };
    const next = jest.fn().mockImplementation((a)=> a);
    const retValue = middleware(dummyStore)(next)(action);
    expect(retValue).toBe(action);
    expect(next).toHaveBeenCalledTimes(1);
    expect(blankActionHandler).toHaveBeenCalledTimes(1);
    // since the action handlers didn't 'cover' the action - the logger shouldn't proceed
    // therefore the validation should never be called
    expect(evtVal).not.toHaveBeenCalled();
    // verify queue is empty
    expect(localStorageMock._queueLength(loggerName)).toBe(0);
  });
  test('middleware skips not applicable action handlers', async () => {
    const evtVal = jest.fn();
    const irrelevantActionHandler = jest.fn((a)=> {
      if (a.type === 'another-type') return {};
      return null;
    } );
    const loggerName = 'test';
    const middleware = createActionLogger({
      name: loggerName,
      actionHandlers: [ irrelevantActionHandler ],
      endpoint: dummyEndpoint,
      logValidator: evtVal,
    });
    const action = {
      type: 'test-type',
    };
    const next = jest.fn().mockImplementation((a)=> a);
    const retValue = middleware(dummyStore)(next)(action);
    expect(retValue).toBe(action);
    expect(next).toHaveBeenCalledTimes(1);
    expect(irrelevantActionHandler).toHaveBeenCalledTimes(1);
    // since the action handlers didn't 'cover' the action - the logger shouldn't proceed
    // therefore the validation should never be called
    expect(evtVal).not.toHaveBeenCalled();
    // verify queue is empty
    expect(localStorageMock._queueLength(loggerName)).toBe(0);
  });
  test('middleware happy path single simple handler', async () => {
    const fakeObject = {
      op: 'test',
      func: 'test',
    };
    const workingHandler = jest.fn((a)=> {
      if (a.type === 'test-type') return fakeObject;
      return null;
    } );
    const loggerName = 'test';

    const middleware = createActionLogger({
      name: loggerName,
      actionHandlers: workingHandler,
      endpoint: dummyEndpoint,
      queueStorage: localStorageMock,
    });
    const action = {
      type: 'test-type',
    };
    const next = jest.fn().mockImplementation((a)=> a);
    const fetchScope = nock(dummyDomain)
      .post(dummyPath)
      .reply(200);

    const retPromise = middleware(dummyStore)(next)(action);

    expect(workingHandler).toHaveBeenCalledTimes(1);
    expect(retPromise).toBeInstanceOf(Promise);
    expect(next).toHaveBeenCalledTimes(0);

    // the middleware returns a promise that is chained with the action
    const retVal = await retPromise;
    // this is after the middlware is actually executed
    expect(retVal).toBe(action);
    expect(next).toHaveBeenCalledTimes(1);
    // verify the item is in the queue
    expect(localStorageMock._queueLength(loggerName)).toBe(1);
    // wait for the fetch to execute
    await sleep(1);
    // verify log is sent
    expect(fetchScope.isDone()).toBeTruthy();
    // verify queue is empty
    expect(localStorageMock._queueLength(loggerName)).toBe(0);
    // console.log(localStorageMock._dumpStore());
  });
  test('middleware endpoint fails - requeues', async () => {
    const fakeObject = {
      op: 'test',
      func: 'test',
    };
    const workingHandler = jest.fn((a)=> {
      if (a.type === 'test-type') return fakeObject;
      return null;
    } );
    const loggerName = 'test';

    const middleware = createActionLogger({
      name: loggerName,
      actionHandlers: [ workingHandler ],
      endpoint: dummyEndpoint,
      queueStorage: localStorageMock,
    });
    const action = {
      type: 'test-type',
    };
    const next = jest.fn().mockImplementation((a)=> a);
    const fetchScope = nock(dummyDomain)
      .post(dummyPath)
      .reply(500, {});

    const retPromise = middleware(dummyStore)(next)(action);

    expect(workingHandler).toHaveBeenCalledTimes(1);
    expect(retPromise).toBeInstanceOf(Promise);
    expect(next).toHaveBeenCalledTimes(0);

    // the middleware returns a promise that is chained with the action
    const retVal = await retPromise;
    // this is after the middlware is actually executed
    expect(retVal).toBe(action);
    expect(next).toHaveBeenCalledTimes(1);
    // verify the item is in the queue
    expect(localStorageMock._queueLength(loggerName)).toBe(1);
    // wait for the fetch to execute
    await sleep(1);
    // verify log is sent. this call will fail
    expect(fetchScope.isDone()).toBeTruthy();
    // verify the item is back in the queue
    expect(localStorageMock._queueLength(loggerName)).toBe(1);
    // console.log(localStorageMock._dumpStore());
  });
  test('middleware endpoint fails first call - requeues, both succeed on second try', async () => {
    const fakeObject = {
      op: 'test',
      func: 'test',
    };
    const workingHandler = jest.fn((a)=> {
      if (a.type === 'test-type') return fakeObject;
      return null;
    } );
    const loggerName = 'test';

    const middleware = createActionLogger({
      name: loggerName,
      actionHandlers: [ workingHandler ],
      endpoint: dummyEndpoint,
      queueStorage: localStorageMock,
    });
    const action = {
      type: 'test-type',
      payload: {},
    };
    const next = jest.fn().mockImplementation((a)=> a);
    let requestNumber = 1;
    // fail the first call, rest succeed
    const fetchScope = nock(dummyDomain)
      .post(dummyPath)
      .times(3) // allow three requests (exactly)
      .reply(() => {
        if (requestNumber++ === 1) {
          return [500, 'Call failed'];
        }
        return [200, 'Ok'];
      });

    await middleware(dummyStore)(next)(action);

    // verify the item is in the queue
    expect(localStorageMock._queueLength(loggerName)).toBe(1);
    // wait for the fetch to execute
    await sleep(1);

    // verify the item is back in the queue
    expect(localStorageMock._queueLength(loggerName)).toBe(1);

    const action2 = {
      type: 'test-type',
      payload: {},
    };
    
    // next log action
    await middleware(dummyStore)(next)(action2);
    // should be two items in the queue now!
    expect(localStorageMock._queueLength(loggerName)).toBe(2);
    // wait for the fetch to execute
    await sleep(1);
    // this will now be three requests. first fails. next two succeed
    expect(fetchScope.isDone()).toBeTruthy();
    // verify log is now flushed
    expect(localStorageMock._queueLength(loggerName)).toBe(0);
  });
  test('middleware verify correct log data sent', async () => {
    const fakeObject = {
      op: 'test',
      func: 'test',
      user: 12345,
      role: 'user',
      arr: [123, 'test', 3.2],
      complexObject: {
        value1: 'test',
        value2: 42,
      },
    };
    const workingHandler = jest.fn((a)=> {
      if (a.type === 'test-type') return fakeObject;
      return null;
    } );
    const loggerName = 'test';

    const middleware = createActionLogger({
      name: loggerName,
      actionHandlers: [ workingHandler ],
      endpoint: dummyEndpoint,
      queueStorage: localStorageMock,
    });
    const action = {
      type: 'test-type',
    };
    const next = jest.fn().mockImplementation((a)=> a);
    const fetchScope = nock(dummyDomain)
      .post(dummyPath, fakeObject)
      .reply(200);

    await middleware(dummyStore)(next)(action);
    // wait for the fetch to execute
    await sleep(1);
    // verify log is sent correctly (this verifies body also)
    expect(fetchScope.isDone()).toBeTruthy();
    // verify queue is empty
    expect(localStorageMock._queueLength(loggerName)).toBe(0);
  });
  test('middleware log validator failure', async () => {
    const fakeObject = {
    };
    const workingHandler = jest.fn((a)=> {
      if (a.type === 'test-type') return fakeObject;
      return null;
    } );
    const loggerName = 'test';
    const falseLogValidator = () => false;

    const middleware = createActionLogger({
      name: loggerName,
      actionHandlers: [ workingHandler ],
      endpoint: dummyEndpoint,
      queueStorage: localStorageMock,
      logValidator: falseLogValidator,
    });
    const action = {
      type: 'test-type',
    };
    const next = jest.fn().mockImplementation((a)=> a);
    const fetchScope = nock(dummyDomain)
      .post(dummyPath)
      .reply(200);
    // because we know this logs a warning as it should
    _suppressConsole(true);
    await middleware(dummyStore)(next)(action);
    // verify queue is empty (since invalid)
    expect(localStorageMock._queueLength(loggerName)).toBe(0);
    // wait for the fetch to execute
    await sleep(1);
    // verify no log was sent (since invalid)
    expect(fetchScope.isDone()).toBeFalsy();
    // verify queue is empty (since invalid)
    expect(localStorageMock._queueLength(loggerName)).toBe(0);
    _suppressConsole(false);
  });
  test('middleware log validator success', async () => {
    const fakeObject = {
      item: 123,
    };
    const workingHandler = jest.fn((a)=> {
      if (a.type === 'test-type') return fakeObject;
      return null;
    } );
    const loggerName = 'test';
    const trueLogValidator = (evt) => evt.item === 123;

    const middleware = createActionLogger({
      name: loggerName,
      actionHandlers: [ workingHandler ],
      endpoint: dummyEndpoint,
      queueStorage: localStorageMock,
      logValidator: trueLogValidator,
    });
    const action = {
      type: 'test-type',
    };
    const next = jest.fn().mockImplementation((a)=> a);
    const fetchScope = nock(dummyDomain)
      .post(dummyPath, fakeObject)
      .reply(200);

    await middleware(dummyStore)(next)(action);

    expect(localStorageMock._queueLength(loggerName)).toBe(1); // in queue
    // wait for the fetch to execute
    await sleep(1);
    // verify log was sent (since valid)
    expect(fetchScope.isDone()).toBeTruthy();
    // verify queue is empty (since sent)
    expect(localStorageMock._queueLength(loggerName)).toBe(0);
  });
  test('middleware injection success', async () => {
    const fakeObject = {
      item: 'test',
    };
    const workingHandler = jest.fn((a)=> {
      if (a.type === 'test-type') return fakeObject;
      return null;
    } );
    const loggerName = 'test';
    const injectedParameters = {
      userId: (state) => state.userId,
      teamId: 123456,
    };

    const middleware = createActionLogger({
      name: loggerName,
      actionHandlers: [ workingHandler ],
      endpoint: dummyEndpoint,
      queueStorage: localStorageMock,
      injectedParameters: injectedParameters,
    });
    const action = {
      type: 'test-type',
    };
    const next = jest.fn().mockImplementation((a)=> a);
    const fetchScope = nock(dummyDomain)
      .post(dummyPath, {
        ...fakeObject,
        userId: dummyStore.getState().userId,
        teamId: injectedParameters.teamId,
      })
      .reply(200);

    await middleware(dummyStore)(next)(action);
    // wait for the fetch to execute
    await sleep(1);
    // verify log was sent with original obj and injectedParamters
    expect(fetchScope.isDone()).toBeTruthy();
  });
  test('middleware two quick sequential log calls', async () => {
    const fakeObject1 = {
      op: 'test',
      func: 'test',
    };
    const fakeObject2 = {
      op: 'test2',
      func: 'test2',
    };
    const workingHandler = jest.fn((a)=> {
      if (a.type === 'test-type1') return fakeObject1;
      if (a.type === 'test-type2') return fakeObject2;
      return null;
    } );
    const loggerName = 'test';

    const middleware = createActionLogger({
      name: loggerName,
      actionHandlers: workingHandler,
      endpoint: dummyEndpoint,
      queueStorage: localStorageMock,
    });
    const action1 = {
      type: 'test-type1',
    };
    const action2 = {
      type: 'test-type2',
    };
    const next = jest.fn().mockImplementation((a)=> a);
    const fetchScope = nock(dummyDomain)
      .post(dummyPath)
      .times(2)
      .reply(200);

    const retVal1 = await middleware(dummyStore)(next)(action1);
    const retVal2 = await middleware(dummyStore)(next)(action2);
    // this is after the middlware is actually executed
    expect(retVal1).toBe(action1);
    expect(retVal2).toBe(action2);
    expect(workingHandler).toHaveBeenCalledTimes(2);
    expect(next).toHaveBeenCalledTimes(2);

    // wait for the fetch to execute
    await sleep(1);
    // verify logs are sent
    expect(fetchScope.isDone()).toBeTruthy();
    // verify queue is empty
    expect(localStorageMock._queueLength(loggerName)).toBe(0);
  });
  test('middleware doesnt send blank log', async () => {
    const fakeObject = {
    };
    const workingHandler = jest.fn((a)=> {
      if (a.type === 'test-type') return fakeObject;
      return null;
    } );
    const loggerName = 'test';

    const middleware = createActionLogger({
      name: loggerName,
      actionHandlers: [ workingHandler ],
      endpoint: dummyEndpoint,
      queueStorage: localStorageMock,
    });
    const action = {
      type: 'test-type',
    };
    const next = jest.fn().mockImplementation((a)=> a);
    const fetchScope = nock(dummyDomain)
      .post(dummyPath)
      .reply(200);

    await middleware(dummyStore)(next)(action);

    expect(localStorageMock._queueLength(loggerName)).toBe(0); // not queued
    // wait for the fetch to execute
    await sleep(1);
    // verify log was not sent
    expect(fetchScope.isDone()).toBeFalsy();
    // verify queue is empty still
    expect(localStorageMock._queueLength(loggerName)).toBe(0);
  });
  test('middleware transform success', async () => {
    const fakeObject = {
      item1: 'test',
    };
    const workingHandler = jest.fn((a)=> {
      if (a.type === 'test-type') return fakeObject;
      return null;
    } );
    const loggerName = 'test';
    const transformFunction = (e) => {
      return {
        data: e,
        message: 'test',
      };
    };
    const middleware = createActionLogger({
      name: loggerName,
      actionHandlers: [ workingHandler ],
      endpoint: {
        ...dummyEndpoint,
        transformFunction: transformFunction,
      },
      queueStorage: localStorageMock,
    });
    const action = {
      type: 'test-type',
    };
    const next = jest.fn().mockImplementation((a)=> a);
    const fetchScope = nock(dummyDomain)
      .post(dummyPath, {
        message: 'test',
        data: fakeObject
      })
      .reply(200);

    await middleware(dummyStore)(next)(action);

    expect(localStorageMock._queueLength(loggerName)).toBe(1); // queued
    // wait for the fetch to execute
    await sleep(1);
    // verify log was sent (with transform)
    expect(fetchScope.isDone()).toBeTruthy();
    // verify queue is empty
    expect(localStorageMock._queueLength(loggerName)).toBe(0);
  });
  test('middleware injection, validation, and transform success', async () => {
    const fakeObject = {
      item1: 'test',
    };
    const workingHandler = jest.fn((a)=> {
      if (a.type === 'test-type') return fakeObject;
      return null;
    } );
    const loggerName = 'test';
    const transformFunction = (e) => {
      return {
        data: e,
        message: 'test',
      };
    };
    const injectedParameters = {
      teamId: 123456,
    };
    // it is important that the validator run on the 'raw' log (before the endpoint transform)
    // but after the injector
    const trueLogValidator = (l) => l.item1 === 'test' && l.teamId=== 123456 && !l.data && !l.message;

    const middleware = createActionLogger({
      name: loggerName,
      actionHandlers: [ workingHandler ],
      endpoint: {
        ...dummyEndpoint,
        transformFunction: transformFunction,
      },
      queueStorage: localStorageMock,
      logValidator: trueLogValidator,
      injectedParameters: injectedParameters,
    });
    const action = {
      type: 'test-type',
    };
    const next = jest.fn().mockImplementation((a)=> a);
    const fetchScope = nock(dummyDomain)
      .post(dummyPath, function (body) {
        return body.message === 'test' && body.data.teamId === injectedParameters.teamId && body.data.item1 === 'test' && !body.item1;
      })
      .reply(200);

    await middleware(dummyStore)(next)(action);

    expect(localStorageMock._queueLength(loggerName)).toBe(1); // queued
    // wait for the fetch to execute
    await sleep(1);
    // verify log was sent (with transform)
    expect(fetchScope.isDone()).toBeTruthy();
    // verify queue is empty
    expect(localStorageMock._queueLength(loggerName)).toBe(0);
  });
  test('middleware client network error => requeues', async () => {
    const fakeObject = {
      item: 123,
    };
    const workingHandler = jest.fn((a)=> {
      if (a.type === 'test-type') return fakeObject;
      return null;
    } );
    const loggerName = 'test';

    const middleware = createActionLogger({
      name: loggerName,
      actionHandlers: [ workingHandler ],
      endpoint: dummyEndpoint,
      queueStorage: localStorageMock,
    });
    const action = {
      type: 'test-type',
    };
    const next = jest.fn().mockImplementation((a)=> a);
    const fetchScope = nock(dummyDomain)
      .post(dummyPath, fakeObject)
      .replyWithError({code: 'ECONNRESET'}); // simulate client network failure

    await middleware(dummyStore)(next)(action);

    expect(localStorageMock._queueLength(loggerName)).toBe(1); // in queue
    // wait for the fetch to execute
    await sleep(5); // this needs to be slightly longer than normal since there is a re-queue async
    // verify log was sent (since valid)
    expect(fetchScope.isDone()).toBeTruthy();
    // verify queue still has item
    expect(localStorageMock._queueLength(loggerName)).toBe(1);
  });
  test('middleware merged headers success', async () => {
    const fakeObject = {
      item1: 'test',
    };
    const workingHandler = jest.fn((a)=> {
      if (a.type === 'test-type') return fakeObject;
      return null;
    } );
    const headers = {
      h: true, 
      b: 'test',
      c: 1234,
      u: (state)=>state.userId,
    };
    const loggerName = 'test';
    const middleware = createActionLogger({
      name: loggerName,
      actionHandlers: [ workingHandler ],
      endpoint: {
        ...dummyEndpoint,
        headers: headers,
      },
      queueStorage: localStorageMock,
    });
    const action = {
      type: 'test-type',
    };

    const next = jest.fn().mockImplementation((a)=> a);
    const fetchScope = nock(dummyDomain)
      .matchHeader('h', 'true')
      .matchHeader('b', 'test')
      .matchHeader('c', '1234')
      .matchHeader('u', dummyStore.getState().userId.toString())
      .post(dummyPath, fakeObject)
      .reply(200);

    await middleware(dummyStore)(next)(action);

    expect(localStorageMock._queueLength(loggerName)).toBe(1); // queued
    // wait for the fetch to execute
    await sleep(1);
    // verify log was sent (with transform)
    expect(fetchScope.isDone()).toBeTruthy();
    // verify queue is empty
    expect(localStorageMock._queueLength(loggerName)).toBe(0);
  });
  // TODO: test merged headers
  // TODO: test server side failure more
});
