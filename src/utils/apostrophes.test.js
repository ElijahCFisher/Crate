import { describe, it, expect, afterEach } from 'vitest';
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { installApostropheStraightener, straightenApostrophes } from './apostrophes';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('straightenApostrophes', () => {
  it('turns curly apostrophes straight', () => {
    expect(straightenApostrophes('Zaidy’s deli, ‘90s')).toBe("Zaidy's deli, '90s");
    expect(straightenApostrophes('don’’t')).toBe("don''t");
  });

  it('leaves one alone after a backslash', () => {
    expect(straightenApostrophes('keep \\’ this, not ’ this')).toBe("keep \\’ this, not ' this");
  });

  it('leaves curly double quotes alone', () => {
    expect(straightenApostrophes('Rudy’s “Country Store”')).toBe("Rudy's “Country Store”");
  });
});

describe('installApostropheStraightener', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  it('fixes a controlled React input before its onChange sees it', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const uninstall = installApostropheStraightener(document);
    const seen = [];
    function Field() {
      const [value, setValue] = useState('');
      return React.createElement('input', {
        value,
        onChange: (e) => { seen.push(e.target.value); setValue(e.target.value); },
      });
    }
    const root = createRoot(container);
    await act(async () => root.render(React.createElement(Field)));
    cleanup = () => { act(() => root.unmount()); container.remove(); uninstall(); };

    const input = container.querySelector('input');
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    await act(async () => {
      setValue.call(input, 'Carl’s Jr');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(seen).toEqual(["Carl's Jr"]);
    expect(input.value).toBe("Carl's Jr");
  });
});
