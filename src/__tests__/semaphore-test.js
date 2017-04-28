'use strict';

import Semaphore  from '../Semaphore.js';

const sleep = function(timeout) {
  return new Promise((resolve) => {
    setTimeout(resolve, timeout);
  });
};

describe('Semaphore validation tests', () => {
  test('1-slot semaphore', async () => {
    const sem = new Semaphore(1);
    let counter = 0;

    const fn = () => {
      sem.acquire().then(() => { counter++; });
    };
    fn();
    fn();

    await sleep(1);

    expect(counter).toEqual(1);
  });
  test('3-slot semaphore where we fill up the slots', async () => {
    const sem = new Semaphore(3);
    let counter = 0;

    const fn = () => {
      sem.acquire().then(() => { counter++; });
    };
    fn();
    fn();
    fn();
    fn();

    await sleep(1);

    expect(counter).toEqual(3);
  });
  test('3-slot semaphore where we play nice and release', async () => {
    const sem = new Semaphore(3);
    let counter = 0;

    const fn = () => {
      sem.acquire().then(() => { counter++; sem.release(); });
    };
    fn();
    fn();
    fn();
    fn();
    fn();

    await sleep(1);

    expect(counter).toEqual(5);
  });
  test('3-slot semaphore with timeouts but no releasing', async () => {
    const sem = new Semaphore(3);
    let successCounter = 0;
    let overallCounter = 0;

    const fn = () => {
      sem.acquire(2).then((hasLock) => { 
        overallCounter++;
        if (hasLock) successCounter++; 
      });
    };
    fn();
    fn();
    fn();
    fn();
    fn();

    await sleep(250);

    expect(overallCounter).toEqual(5);
    expect(successCounter).toEqual(3);
  });
  test('3-slot semaphore with timeouts', async () => {
    const sem = new Semaphore(3);
    let successCounter = 0;
    let overallCounter = 0;

    const fn = () => {
      sem.acquire(10).then((hasLock) => { 
        overallCounter++;
        if (hasLock) successCounter++;
        sem.release();
      });
    };
    fn();
    fn();
    fn();
    fn();
    fn();

    await sleep(250);

    expect(overallCounter).toEqual(5);
    expect(successCounter).toEqual(5);
  });
  test('3-slot semaphore with timeouts', async () => {
    const sem = new Semaphore(3);
    let successCounter = 0;
    let overallCounter = 0;

    const fn = () => {
      sem.acquire(10).then(async (hasLock) => { 
        overallCounter++;
        if (hasLock) successCounter++;
        await sleep(12); // wait longer than the given acquire timeout
        sem.release();
      });
    };
    fn();
    fn();
    fn();
    fn();
    fn();

    await sleep(250);

    expect(overallCounter).toEqual(5);
    expect(successCounter).toEqual(3);
  });
});
