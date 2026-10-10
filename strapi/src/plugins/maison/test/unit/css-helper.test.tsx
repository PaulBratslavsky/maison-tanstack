// @vitest-environment jsdom
import { render } from '@testing-library/react';
import styled from 'styled-components';
import { describe, expect, it } from 'vitest';
import { declarationsOf, keyframesCss, mediaDeclarationsOf, mediaQueriesOf } from './css';
import './render';

/** The helper the component tests read CSS with, held by a component that has every kind of rule it reads. */
const Sample = styled.div`
  color: red;
  margin: 0 0 8px;

  table {
    display: block;
  }
  th,
  td {
    padding: 4px 8px;
    text-align: left;
  }
  td {
    padding: 6px;
    overflow-wrap: break-word;
  }
  &::after {
    content: 'x';
  }
  @media (prefers-reduced-motion: reduce) {
    color: blue;
    td {
      padding: 0;
    }
  }
  @media (min-width: 768px) {
    margin: 0 0 24px;
  }
`;

const sample = () => {
  const { container } = render(<Sample />);
  return container.firstElementChild as Element;
};

describe('the CSS helpers of the component tests', () => {
  it('read each declaration of the element by its name, in whatever order they were written', () => {
    expect(declarationsOf(sample())).toMatchObject({ color: 'red', margin: '0 0 8px' });
  });

  it('read the rules for what is inside it, from a rule that lists several selectors and from one of its own, and the later rule wins', () => {
    const element = sample();
    expect(declarationsOf(element, ' table')).toEqual({ display: 'block' });
    expect(declarationsOf(element, ' th')).toEqual({ padding: '4px 8px', 'text-align': 'left' });
    expect(declarationsOf(element, ' td')).toEqual({ padding: '6px', 'text-align': 'left', 'overflow-wrap': 'break-word' });
  });

  it('read the rules for a pseudo-element', () => {
    expect(declarationsOf(sample(), '::after')).toEqual({ content: "'x'" });
  });

  it('read the rules inside a media query on their own, and leave them out of the plain rules', () => {
    const element = sample();
    expect(mediaDeclarationsOf(element, '(prefers-reduced-motion: reduce)')).toEqual({ color: 'blue' });
    expect(mediaDeclarationsOf(element, '(prefers-reduced-motion: reduce)', ' td')).toEqual({ padding: '0' });
    expect(mediaDeclarationsOf(element, '(min-width: 768px)')).toEqual({ margin: '0 0 24px' });
    expect(declarationsOf(element).color).toBe('red');
  });

  it('name the media queries that hold a rule for the element, or for a part of it, and none for an element that has none', () => {
    const element = sample();
    expect(mediaQueriesOf(element).sort()).toEqual(['(min-width:768px)', '(prefers-reduced-motion:reduce)']);
    expect(mediaQueriesOf(element, ' td')).toEqual(['(prefers-reduced-motion:reduce)']);
    expect(mediaQueriesOf(element, ' table')).toEqual([]);
    expect(mediaQueriesOf(render(<p>Plain</p>).container.firstElementChild as Element)).toEqual([]);
  });

  it('read nothing for an element styled-components did not write rules for', () => {
    const { container } = render(<p>Plain</p>);
    expect(declarationsOf(container.firstElementChild as Element)).toEqual({});
  });

  it('read keyframes as text', () => {
    expect(keyframesCss()).toBeTypeOf('string');
  });
});
