import { EMPTY, Observable } from 'rxjs';
import { materialize, dematerialize, expand, filter } from 'rxjs/operators';

export const switchRepeat = <T>(factory: () => Observable<T>) => (
  source: Observable<T>
) =>
  source.pipe(
    materialize(),
    expand(value => {
      if (value.kind === 'C') {
        return factory().pipe(materialize());
      }
      return EMPTY;
    }),
    filter(v => v.kind !== 'C'),
    dematerialize()
  );
