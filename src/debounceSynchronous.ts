import { Observable } from 'rxjs';

const EMPTY = {};
export function debounceSynchronous<T>() {
  return (source: Observable<T>) =>
    new Observable<T>(obs => {
      let lastValue: { value: T } = EMPTY as any;

      const sub = source.subscribe({
        next: v => {
          if (lastValue === EMPTY) {
            queueMicrotask(() => {
              obs.next(lastValue.value);
              lastValue = EMPTY as any;
            });
          }
          lastValue.value = v;
        },
        error: e => obs.error(e),
        complete: () => obs.complete(),
      });
      return () => sub.unsubscribe();
    });
}
