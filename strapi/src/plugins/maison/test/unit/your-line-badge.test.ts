import { describe, expect, it } from 'vitest';
import { YOUR_LINE_LABEL, YOUR_LINE_TITLE, yourLineBadge } from '../../admin/src/your-line';

describe('yourLineBadge: the label on the presenter\'s own rows', () => {
  it('says "Your LINE", with a title that says where replies and confirmations go', () => {
    expect(yourLineBadge({ yourLine: true })).toEqual({
      label: 'Your LINE',
      title: 'Replies and confirmations for this customer go to your own LINE account.',
    });
    expect(YOUR_LINE_LABEL).toBe('Your LINE');
    expect(YOUR_LINE_TITLE).toBe('Replies and confirmations for this customer go to your own LINE account.');
  });

  it.each([
    ['a row that is not yours', { yourLine: false }],
    ['a row that does not say, as a row from an older server', {}],
    ['a row with yourLine undefined', { yourLine: undefined }],
    ['a row with a value that is not true', { yourLine: 'true' as never }],
    ['a row with 1', { yourLine: 1 as never }],
    ['a row with null', { yourLine: null as never }],
  ])('shows nothing for %s', (_label, row) => {
    expect(yourLineBadge(row)).toBeNull();
  });

  it('never names a LINE user ID', () => {
    expect(`${YOUR_LINE_LABEL} ${YOUR_LINE_TITLE}`).not.toMatch(/U[0-9a-f]{32}/);
  });
});
