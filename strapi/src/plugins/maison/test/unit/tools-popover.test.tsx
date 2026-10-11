// @vitest-environment jsdom
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ToolsPopover } from '../../admin/src/components/assistant/ToolsPopover';
import { TOOL_NOTES } from '../../admin/src/assistant';
import { TOOL_LABELS, READ_TOOL_NAMES } from '../../server/src/assistant/tools';
import { renderInTheme } from './render';

const ALL = READ_TOOL_NAMES.map((name) => ({ name, label: TOOL_LABELS[name] }));
const open = async () => userEvent.click(screen.getByRole('button', { name: /^Tools \(/ }));

describe('ToolsPopover', () => {
  it('is a button that says how many tools there are, with the list closed', () => {
    renderInTheme(<ToolsPopover tools={ALL} />);
    const button = screen.getByRole('button', { name: 'Tools (7)' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens a read-only list: the sentence about what the assistant never does, the group "Read only", and every tool', async () => {
    renderInTheme(<ToolsPopover tools={ALL} />);
    await open();

    const dialog = screen.getByRole('dialog', { name: 'Tools' });
    expect(screen.getByRole('button', { name: 'Tools (7)' }).getAttribute('aria-expanded')).toBe('true');
    expect(within(dialog).getByText('The assistant looks things up. It never sends, confirms or changes anything.')).toBeTruthy();
    expect(within(dialog).getByText('Read only')).toBeTruthy();
    for (const { name, label } of ALL) {
      expect(within(dialog).getByText(label), label).toBeTruthy();
      expect(within(dialog).getByText(name).tagName, name).toBe('CODE');
      expect(within(dialog).getByText(TOOL_NOTES[name]), name).toBeTruthy();
    }
  });

  it('has no switches: the tools are fixed, and the list only tells staff what is there', async () => {
    renderInTheme(<ToolsPopover tools={ALL} />);
    await open();
    expect(screen.queryAllByRole('checkbox')).toEqual([]);
    expect(screen.queryAllByRole('switch')).toEqual([]);
  });

  it('lists only the tools it is given, so a role that may read less sees less', async () => {
    renderInTheme(<ToolsPopover tools={[{ name: 'list_inquiries', label: 'Inquiries' }, { name: 'inquiry_counts', label: 'Inquiry counts' }]} />);
    expect(screen.getByRole('button', { name: 'Tools (2)' })).toBeTruthy();
    await open();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Inquiries')).toBeTruthy();
    expect(within(dialog).queryByText('Visit requests')).toBeNull();
    expect(within(dialog).queryByText('list_requests')).toBeNull();
  });

  it('says so when the role has no tools: the button still shows, with a zero', async () => {
    renderInTheme(<ToolsPopover tools={[]} />);
    await open();
    expect(screen.getByRole('button', { name: 'Tools (0)' })).toBeTruthy();
    expect(within(screen.getByRole('dialog')).getByText("Your role has no tools, so the assistant can't look anything up.")).toBeTruthy();
  });

  it('shows a tool the page has no line for by its label and name alone', async () => {
    renderInTheme(<ToolsPopover tools={[{ name: 'something_new', label: 'Something new' }]} />);
    await open();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Something new')).toBeTruthy();
    expect(within(dialog).getByText('something_new').tagName).toBe('CODE');
  });

  it('closes when the button is pressed again, on Escape, and on a press outside', async () => {
    renderInTheme(
      <>
        <ToolsPopover tools={ALL} />
        <p>Outside</p>
      </>
    );
    await open();
    await open();
    expect(screen.queryByRole('dialog')).toBeNull();

    await open();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();

    await open();
    fireEvent.mouseDown(screen.getByText('Outside'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  // In the drawer, Escape closes the drawer. With the list of tools open, the first Escape is for the list, and the next is for the drawer.
  it('keeps the Escape that closes it to itself, so what is around it does not also act on it, and lets the next Escape through', async () => {
    const onKeyDown = vi.fn();
    renderInTheme(
      <div onKeyDown={onKeyDown}>
        <ToolsPopover tools={ALL} />
      </div>
    );
    await open();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onKeyDown).not.toHaveBeenCalled();

    await userEvent.keyboard('{Escape}');
    expect(onKeyDown).toHaveBeenCalledOnce();
  });

  it('lets any other key through to what is around it while it is open', async () => {
    const onKeyDown = vi.fn();
    renderInTheme(
      <div onKeyDown={onKeyDown}>
        <ToolsPopover tools={ALL} />
      </div>
    );
    await open();
    await userEvent.keyboard('a');
    expect(onKeyDown).toHaveBeenCalledOnce();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('stays open for a press inside it, and for any other key', async () => {
    renderInTheme(<ToolsPopover tools={ALL} />);
    await open();
    fireEvent.mouseDown(screen.getByText('Visit requests'));
    fireEvent.keyDown(document, { key: 'a' });
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
