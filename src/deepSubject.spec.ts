import { Observable } from 'rxjs';
import { deepSubject } from './deepSubject';

interface State {
  foo: string;
  bar: number;
}

describe('deepSubject', () => {
  test('emits immediately with the latest value', () => {
    const value$ = deepSubject(5);
    const valueObs = readObservable(value$);

    expect(valueObs.values.length).toBe(1);
    expect(valueObs.values[0]).toBe(5);

    value$.next(10);
    expect(valueObs.values.length).toBe(2);
    expect(valueObs.values[1]).toBe(10);

    value$.error('error');
    expect(valueObs.values.length).toBe(2);
    expect(valueObs.error).toBe('error');
  });

  test('notifies only relevant subscribers', () => {
    const state$ = deepSubject<State>({
      foo: 'foo',
      bar: 5,
    });

    const stateObs = readObservable(state$);
    const fooObs = readObservable(state$.getChild('foo'));
    const barObs = readObservable(state$.getChild('bar'));
    expect(stateObs.values.length).toBe(1);
    expect(stateObs.values[0]).toEqual({
      foo: 'foo',
      bar: 5,
    });
    expect(fooObs.values.length).toBe(1);
    expect(fooObs.values[0]).toBe('foo');
    expect(barObs.values.length).toBe(1);
    expect(barObs.values[0]).toBe(5);

    state$.getChild('bar').next(10);
    expect(stateObs.values.length).toBe(2);
    expect(stateObs.values[1]).toEqual({
      foo: 'foo',
      bar: 10,
    });
    expect(fooObs.values.length).toBe(1);
    expect(barObs.values.length).toBe(2);
    expect(barObs.values[1]).toBe(10);
  });

  test('works with nested objects', () => {
    const state$ = deepSubject({
      a: {
        b: 2,
      },
    });

    const stateObs = readObservable(state$);
    const aObs = readObservable(state$.getChild('a'));
    const bObs = readObservable(state$.getChild('a').getChild('b'));
    expect(stateObs.values.length).toBe(1);
    expect(stateObs.values[0]).toEqual({
      a: {
        b: 2,
      },
    });
    expect(aObs.values.length).toBe(1);
    expect(aObs.values[0]).toEqual({
      b: 2,
    });
    expect(bObs.values.length).toBe(1);
    expect(bObs.values[0]).toBe(2);

    state$
      .getChild('a')
      .getChild('b')
      .next(3);
    expect(stateObs.values.length).toBe(2);
    expect(stateObs.values[1]).toEqual({
      a: {
        b: 3,
      },
    });
    expect(aObs.values.length).toBe(2);
    expect(aObs.values[1]).toEqual({
      b: 3,
    });
    expect(bObs.values.length).toBe(2);
    expect(bObs.values[1]).toBe(3);

    state$.next({
      a: {
        b: 4,
      },
    });
    expect(stateObs.values.length).toBe(3);
    expect(stateObs.values[2]).toEqual({
      a: {
        b: 4,
      },
    });
    expect(aObs.values.length).toBe(3);
    expect(aObs.values[2]).toEqual({
      b: 4,
    });
    expect(bObs.values.length).toBe(3);
    expect(bObs.values[2]).toBe(4);
  });

  test('works with eager subscriptions', () => {
    const state$ = deepSubject<any>();

    const stateObs = readObservable(state$);
    const aObs = readObservable(state$.getChild('a'));
    expect(stateObs.values.length).toBe(0);
    expect(aObs.values.length).toBe(0);

    state$.getChild('a').next(2);
    expect(stateObs.values.length).toBe(1);
    expect(stateObs.values[0]).toEqual({
      a: 2,
    });
    expect(aObs.values.length).toBe(1);
    expect(aObs.values[0]).toBe(2);
  });

  test('complete on subtrees remove them from value', () => {
    const state$ = deepSubject({
      a: 3,
      b: 2,
      c: {
        d: 2,
      },
    });

    const stateObs = readObservable(state$);
    state$.getChild('b').complete();
    state$.getChild('c').complete();
    expect(stateObs.values.length).toBe(3);
    expect(stateObs.values[2]).toEqual({
      a: 3,
    });
  });

  test('pushing a value omitting keys completes the observables of those', () => {
    const state$ = deepSubject<any>({
      a: 3,
      b: 2,
      c: {
        d: 2,
      },
    });

    const bObs = readObservable(state$.getChild('b'));
    const cObs = readObservable(state$.getChild('c'));
    state$.next({
      a: 4,
    });
    expect(bObs.values.length).toBe(1);
    expect(bObs.isComplete).toBe(true);
    expect(cObs.values.length).toBe(1);
    expect(cObs.isComplete).toBe(true);
  });

  test(`doesn't emit when one of the values hasn't changed`, () => {
    const state$ = deepSubject({
      a: 3,
      b: 2,
    });

    const bObs = readObservable(state$.getChild('b'));
    state$.next({
      a: 4,
      b: 2,
    });
    state$.getChild('b').complete();
    expect(bObs.values.length).toBe(1);
  });

  test(`doesn't intercept class instances`, () => {
    const state$ = deepSubject<any>();
    state$.getChild('obs').next(new Observable());
    expect(state$.getChild('obs').getValue() instanceof Observable).toBe(true);

    const obs$ = deepSubject(new Observable());
    expect(obs$.getValue() instanceof Observable).toBe(true);
  });

  test('it keeps undefined values on inner keys', () => {
    const state$ = deepSubject({
      foo: undefined,
      bar: 1,
    });
    expect(state$.getValue()).toHaveProperty('foo');
    const observed = readObservable(state$);
    expect(observed.values[observed.values.length - 1]).toHaveProperty('foo');

    state$.getChild('bar').next(2);
    expect(state$.getValue()).toHaveProperty('foo');
    expect(observed.values[observed.values.length - 1]).toHaveProperty('foo');
  });
});

function readObservable<T>(obs: Observable<T>) {
  const result = {
    values: [] as T[],
    error: null as any,
    isComplete: false,
  };

  obs.subscribe(
    res => {
      result.values.push(res);
    },
    err => (result.error = err),
    () => (result.isComplete = true)
  );

  return result;
}
