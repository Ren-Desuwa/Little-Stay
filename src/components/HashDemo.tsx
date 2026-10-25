import { useState } from 'react';
import HashInsertionDemo from './HashInsertionDemo';
import HashLookupDemo from './HashLookupDemo';
import type { Data } from '../lib/model';

export default function HashDemo({ data }: { data: Data }) {
  const [mode, setMode] = useState('insert');
  return (
    <>
      <div className="lab-tabs" role="group" aria-label="Hash operation">
        <button
          className={mode === 'insert' ? 'active' : ''}
          aria-pressed={mode === 'insert'}
          onClick={() => setMode('insert')}
        >
          Insert keys into buckets
        </button>
        <button
          className={mode === 'lookup' ? 'active' : ''}
          aria-pressed={mode === 'lookup'}
          onClick={() => setMode('lookup')}
        >
          Look up application records
        </button>
      </div>
      {mode === 'insert' ? <HashInsertionDemo /> : <HashLookupDemo data={data} />}
    </>
  );
}
