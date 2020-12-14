import {
  BehaviorSubject,
  concat,
  merge,
  Observable,
  Observer,
  of,
  Subject,
} from 'rxjs';
import {
  filter,
  map,
  mergeMap,
  multicast,
  refCount,
  scan,
  switchMap,
  takeUntil,
  tap,
} from 'rxjs/operators';

export interface DeepSubject<T> extends Observable<T>, Observer<T> {
  hasValue: () => boolean;
  getValue: () => T;
  getChild: <K extends keyof T>(key: K) => DeepSubject<T[K]>;
  getKeys: () => (keyof T)[];
}

const EMPTY = {};
export function deepSubject<T>(initialValue: T = EMPTY as any): DeepSubject<T> {
  const children$ = new Subject<{
    key: keyof T;
    subject: DeepSubject<any>;
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
      }, initial)
    );
  const resetNested$ = new Subject();
  const value$ = merge(
    next$,
    nestedValue$(initialValue).pipe(takeUntil(resetNested$)),
    resetNested$.pipe(switchMap(() => nestedValue$({} as any)))
  ).pipe(
    multicast(new BehaviorSubject(initialValue)),
    refCount(),
    filter(v => v !== EMPTY)
  );
  const sub = value$.subscribe(v => (latestValue = v));
  sub.add(
    resetNested$.subscribe(() => {
      const allSubjects = new Set(childSubjects.values());
      childSubjects.clear();
      allSubjects.forEach(s => s.complete());
    })
  );

  let isProcessing = false; // Disables emitting values
  const processValue = (value: T) => {
    if (!isPlainObject(value)) {
      resetNested$.next();
      next$.next(value);
      return;
    }
    const omittedKeys = new Set(childSubjects.keys());
    isProcessing = true;
    next$.next(value);
    Object.keys(value).forEach(k => {
      const key = k as keyof T;
      omittedKeys.delete(key);
      const innerValue = value[key as keyof T];
      if (childSubjects.has(key)) {
        const child = childSubjects.get(key)!;
        if (!child.hasValue() || child.getValue() !== innerValue) {
          child.next(innerValue);
        }
      } else {
        const child = deepSubject(innerValue);
        childSubjects.set(key, child);
        children$.next({ key, subject: child });
      }
    });
    omittedKeys.forEach(key => childSubjects.get(key!)?.complete());
    isProcessing = false;
    next$.next(latestValue);
  };
  processValue(initialValue);

  const completeSignal$ = new Subject();
  const observer: Observer<T> = {
    next: processValue,
    error: e => {
      // Please don't...
      sub.unsubscribe();
      isProcessing = true;
      childSubjects.forEach(s => s.error(e));
      childSubjects.clear();
      isProcessing = false;
      completeSignal$.error(e);
    },
    complete: () => {
      sub.unsubscribe();
      isProcessing = true;
      childSubjects.forEach(s => s.complete());
      childSubjects.clear();
      isProcessing = false;
      completeSignal$.next();
    },
  };

  return Object.assign(
    value$.pipe(
      takeUntil(completeSignal$),
      filter(() => !isProcessing)
    ),
    observer,
    {
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
      getKeys: () => Array.from(childSubjects.keys()),
    }
  );
}

const isPlainObject = (value: any) =>
  value !== null &&
  typeof value === 'object' &&
  value.__proto__ === Object.prototype;
