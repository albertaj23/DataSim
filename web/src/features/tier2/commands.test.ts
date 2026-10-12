import { beforeEach, describe, expect, it } from 'vitest';
import { collectCommands, groupCommands, registerCommands, scoreCommand, useCommandRegistry, useTier2Ui, type Command } from './commands';

const cmd = (id: string, group: string, extra: Partial<Command> = {}): Command => ({ id, title: id, group, run: () => undefined, ...extra });

describe('command registry', () => {
  beforeEach(() => useCommandRegistry.setState({ sources: {} }));

  it('registers and unregisters per owner', () => {
    const off = registerCommands('studio', [cmd('a', 'Run')]);
    registerCommands('global', [cmd('b', 'Navigate')]);
    expect(collectCommands(useCommandRegistry.getState().sources).map((c) => c.id).sort()).toEqual(['a', 'b']);
    off();
    expect(collectCommands(useCommandRegistry.getState().sources).map((c) => c.id)).toEqual(['b']);
  });

  it('re-registering an owner replaces its commands', () => {
    registerCommands('studio', [cmd('a', 'Run')]);
    registerCommands('studio', [cmd('c', 'Run')]);
    expect(collectCommands(useCommandRegistry.getState().sources).map((c) => c.id)).toEqual(['c']);
  });

  it('hides commands whose `when` is false and drops duplicate ids', () => {
    const list = collectCommands({ x: [cmd('a', 'Run', { when: () => false }), cmd('b', 'Run'), cmd('b', 'Design')], y: [cmd('b', 'Navigate')] });
    expect(list.map((c) => `${c.id}:${c.group}`)).toEqual(['b:Run']);
  });

  it('orders groups with studio groups first and unknown groups last', () => {
    const g = groupCommands([cmd('1', 'Navigate'), cmd('2', 'Zeta'), cmd('3', 'Run'), cmd('4', 'Alpha'), cmd('5', 'Run')]);
    expect(g.map((x) => x.group)).toEqual(['Run', 'Navigate', 'Alpha', 'Zeta']);
    expect(g[0]!.items.map((c) => c.id)).toEqual(['3', '5']);
  });

  it('a UI request is consumed once and only by its owner', () => {
    useTier2Ui.getState().request('normalize');
    expect(useTier2Ui.getState().consume('query')).toBe(false);
    expect(useTier2Ui.getState().consume('normalize')).toBe(true);
    expect(useTier2Ui.getState().consume('normalize')).toBe(false);
  });
});

describe('scoreCommand', () => {
  it('requires every word, in any order, and ignores scattered letters', () => {
    expect(scoreCommand('Editors Normalize schema (BCNF / 3NF assistant)', 'normalize')).toBeGreaterThan(0);
    expect(scoreCommand('Isolation Set isolation to READ COMMITTED', 'normalize')).toBe(0);
    expect(scoreCommand('Strategy Set strategy to atomic', 'atomic set')).toBeGreaterThan(0);
    expect(scoreCommand('Strategy Set strategy to atomic', 'atomic zzz')).toBe(0);
  });
  it('matches keywords and ranks exact phrases higher', () => {
    expect(scoreCommand('Run Run capacity test', 'usl', ['usl', 'knee'])).toBeGreaterThan(0);
    expect(scoreCommand('Run Run load test', 'load test')).toBeGreaterThan(scoreCommand('Run Run load test', 'test load'));
    expect(scoreCommand('anything', '')).toBe(1);
  });
});
