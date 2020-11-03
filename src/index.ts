import { concat, merge, Observable, Observer, of, Subject } from 'rxjs';
import {
  mergeMap,
  map,
  scan,
  share,
  tap,
  takeUntil,
  startWith,
  switchMap,
} from 'rxjs/operators';
import { debounceSynchronous } from './debounceSynchronous';

export interface DeepSubject<T> extends Observable<T>, Observer<T> {
  hasValue: () => boolean;
  getValue: () => T;
  getChild: <K extends keyof T>(key: K) => DeepSubject<T[K]>;
}

const EMPTY = {};
export function deepSubject<T>(initialValue: T = EMPTY as any): DeepSubject<T> {
  const children$ = new Subject<{
    key: keyof T;
    subject: Observable<any>;
  }>();
  const childSubjects = new Map<keyof T, DeepSubject<any>>();
  let latestValue: T = initialValue;

  const next$ = new Subject<T>();
  const nestedValue$ = (initial: T) =>
    children$.pipe(
      mergeMap(({ key, subject }) =>
        concat(
          subject.pipe(map(value => ({ type: 'update' as const, key, value }))),
          of({ type: 'delete' as const, key }).pipe(
            tap(({ key }) => childSubjects.delete(key))
          )
        )
      ),
      scan((old, action) => {
        if (action.type === 'update') {
          return {
            ...old,
            [action.key]: action.value,
          };
        } else {
          const { [action.key]: _, ...newValue } = old as any;
          return newValue as T;
        }
      }, initial),
      debounceSynchronous(),
      share()
    );
  const resetNested$ = new Subject();
  const value$ = merge(
    next$,
    resetNested$.pipe(
      startWith(null),
      switchMap(() => nestedValue$(latestValue))
    )
  ).pipe(share());
  const sub = value$.subscribe(v => (latestValue = v));
  sub.add(
    resetNested$.subscribe(() => {
      childSubjects.forEach(s => s.complete());
      childSubjects.clear();
    })
  );

  const processValue = (value: T) => {
    if (value === null || typeof value !== 'object') {
      resetNested$.next();
      next$.next(value);
      return;
    }
    const omittedKeys = new Set(childSubjects.keys());
    Object.keys(value).forEach(k => {
      const key = k as keyof T;
      omittedKeys.delete(key);
      const innerValue = value[key as keyof T];
      if (childSubjects.has(key)) {
        childSubjects.get(key)!.next(innerValue);
      } else {
        const child = deepSubject(innerValue);
        childSubjects.set(key, child);
        children$.next({ key, subject: child });
      }
    });
    omittedKeys.forEach(key => childSubjects.get(key!)?.complete());
  };
  processValue(initialValue);

  const completeSignal$ = new Subject();
  const observer: Observer<T> = {
    next: processValue,
    error: e => {
      // Please don't...
      sub.unsubscribe();
      childSubjects.forEach(s => s.error(e));
      childSubjects.clear();
      completeSignal$.error(e);
    },
    complete: () => {
      sub.unsubscribe();
      childSubjects.forEach(s => s.complete());
      childSubjects.clear();
      completeSignal$.next();
    },
  };

  return Object.assign(value$.pipe(takeUntil(completeSignal$)), observer, {
    hasValue: () => latestValue !== EMPTY,
    getValue: () => {
      if (latestValue === EMPTY) {
        throw new Error('Empty subject');
      }
      return latestValue;
    },
    getChild: (key: keyof T) => {
      if (!childSubjects.has(key)) {
        const child = deepSubject();
        childSubjects.set(key, child);
        children$.next({ key, subject: child });
      }
      return childSubjects.get(key)!;
    },
  });
}
