'use strict';

import LargeItemLocalQueue from '../LargeItemLocalQueue';

const localStorageMock = (function() {
  let store = {};
  return {
    getItem: function(key) {
      return store[key];
    },
    setItem: function(key, value) {
      store[key] = value.toString();
    },
    removeItem: function(key) {
      delete store[key];
    }
  };
})();

describe('largeItemLocalQueue initialization', () => {
  test('attempt to largeItemLocalQueue with invalid inputs', async () => {
    expect(()=>new LargeItemLocalQueue()).toThrowError(/prefix/);
    expect(()=>new LargeItemLocalQueue(123)).toThrowError(/prefix/);
    expect(()=>new LargeItemLocalQueue(null)).toThrowError(/prefix/);
    expect(()=>new LargeItemLocalQueue('')).toThrowError(/prefix/);

    expect(()=>new LargeItemLocalQueue('test', null)).toThrowError(/backend/);   
    expect(()=>new LargeItemLocalQueue('test', {})).toThrowError(/backend/);  
    expect(()=>new LargeItemLocalQueue('test', 'storage')).toThrowError(/backend/);   
  });
  
  test('attempt to largeItemLocalQueue with valid inputs', async () => {
    expect(()=>new LargeItemLocalQueue('test')).toBeTruthy(); 
    expect(()=>new LargeItemLocalQueue('test', localStorageMock)).toBeTruthy(); 
  });
});

describe('push() tests', () => {
  test('invalid parameters', async () => {
    const q = new LargeItemLocalQueue('test');
    // in this version of Jest throwing async errors is messed up :(
    const hasError = await q.push(null)
      .then(()=>false, ()=>true);
    expect(hasError).toBeTruthy();

    const hasError2 = await q.push()
      .then(()=>false, ()=>true);
    expect(hasError2).toBeTruthy();
  });
  test('test primatives', async () => {
    const q = new LargeItemLocalQueue('test');
    await q.push(true);
    await q.push(123);
    await q.push('test');
    await q.push(1.1234);

    expect(await q.pop()).toBe(true);
    expect(await q.pop()).toBe(123);
    expect(await q.pop()).toBe('test');
    expect(await q.pop()).toBe(1.1234);

  });
  test('happy path test', async () => {
    const q = new LargeItemLocalQueue('test');
    const testItem = {
      a: 1,
      b: true,
      c: 'test',
      d: [],
      e: {
        e1: 1,
        e2: 3,
      },
    };

    await q.push(testItem);

    // check for item with peek
    const peekItem = await q.peek();
    expect(peekItem).toMatchObject(testItem);

    //check for item with pop
    const popItem = await q.pop();
    expect(popItem).toMatchObject(testItem);

    //verify nothing in the queue
    expect(await q.peek()).toBeNull();
    expect(await q.pop()).toBeNull();
  });
  test('happy path 2 item test', async () => {
    const q = new LargeItemLocalQueue('test');
    const testItem1 = {
      a: 'test1',
    };
    const testItem2 = {
      b: 'test2',
    };

    await q.push(testItem1);
    await q.push(testItem2);

    // check for item with pop
    const popItem = await q.pop();
    expect(popItem).toMatchObject(testItem1);
    // expect one item still in queue
    expect(await q.peek()).toBeTruthy();

    const popItem2 = await q.pop();
    expect(popItem2).toMatchObject(testItem2);
    // expect empty queue
    expect(await q.peek()).toBeNull();
  });
  test('happy path 2 item push,pop,push,pop', async () => {
    const q = new LargeItemLocalQueue('test');
    const testItem1 = {
      a: 'test1',
    };
    const testItem2 = {
      b: 'test2',
    };

    await q.push(testItem1);

    // check for item with pop
    const popItem = await q.pop();
    expect(popItem).toMatchObject(testItem1);
    // expect one item still in queue
    expect(await q.peek()).toBeNull();

    await q.push(testItem2);

    const popItem2 = await q.pop();
    expect(popItem2).toMatchObject(testItem2);
    // expect empty queue
    expect(await q.peek()).toBeNull();
  });
});

describe('pushAll() tests', () => {
  test('invalid parameters', async () => {
    const q = new LargeItemLocalQueue('test');
    // in this version of Jest throwing async errors is messed up :(
    expect(await q.pushAll(null).then(()=>false, ()=>true)).toBeTruthy();
    expect(await q.pushAll().then(()=>false, ()=>true)).toBeTruthy();
    expect(await q.pushAll([]).then(()=>false, ()=>true)).toBeTruthy();
    expect(await q.pushAll({}).then(()=>false, ()=>true)).toBeTruthy();
  });
  test('happy path', async () => {
    const q = new LargeItemLocalQueue('test');
    const item1 = {
      a: true,
      b: 1234,
      c: 'test',
      d: ['test'],
    };    
    const item2 = {
      a: false,
      b2: {
        a1: '1234',
      },
    };
    await q.pushAll([item1, item2]);

    // check for item with peek
    expect(await q.peek()).toMatchObject(item1);

    // check for item with pop
    expect(await q.pop()).toMatchObject(item1);
    // check second item
    expect(await q.pop()).toMatchObject(item2);

    // verify nothing in the queue
    expect(await q.peek()).toBeNull();
    expect(await q.pop()).toBeNull();
  });
  test('happy path with repeat pushAll', async () => {
    const q = new LargeItemLocalQueue('test');
    const item1 = {
      a: true,
      b: 1234,
      c: 'test',
      d: ['test'],
    };    
    const item2 = {
      a: false,
      b2: {
        a1: '1234',
      },
    };
    await q.pushAll([item1, item2]);

    const item3 = {
      test3: '1234',
    };
    const item4 = {
      test4: 'another',
    };
    await q.pushAll([item3, item4]);
    // check for items
    expect(await q.pop()).toMatchObject(item1);
    expect(await q.pop()).toMatchObject(item2);
    expect(await q.pop()).toMatchObject(item3);
    expect(await q.pop()).toMatchObject(item4);

    expect(await q.pop()).toBeNull();
  });
});