import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { I18nObserver } from '../src/I18nObserver';
import { resolveListOption } from '../src/listOption';
import { DEFAULT_IGNORE_SELECTORS } from '../src/defaults';
import type { TranslationItem } from '../src/types';

async function flushDebounce(): Promise<void> {
  vi.advanceTimersByTime(250);
  await vi.runAllTimersAsync();
}

/** Every masked string reported to onMissingTranslation across all flushes. */
function reported(onMissing: ReturnType<typeof vi.fn>): string[] {
  return onMissing.mock.calls.flatMap((call) => (call[0] as TranslationItem[]).map((i) => i.masked));
}

describe('resolveListOption', () => {
  const defaults = ['a', 'b'];

  it('returns the defaults verbatim when the user value is undefined', () => {
    expect(resolveListOption(undefined, defaults)).toEqual(['a', 'b']);
  });

  it('unions a plain array with the defaults', () => {
    expect(resolveListOption(['c'], defaults)).toEqual(['a', 'b', 'c']);
  });

  it('deduplicates when the consumer repeats a default', () => {
    expect(resolveListOption(['b', 'c'], defaults)).toEqual(['a', 'b', 'c']);
  });

  it('uses a function return value verbatim — no further merging', () => {
    expect(resolveListOption(() => ['only'], defaults)).toEqual(['only']);
  });

  it('passes the defaults to the function form so a single entry can be removed', () => {
    expect(resolveListOption((d) => d.filter((s) => s !== 'a'), defaults)).toEqual(['b']);
  });

  it('does not mutate or alias the defaults array', () => {
    const result = resolveListOption(['c'], defaults);
    result.push('d');
    expect(defaults).toEqual(['a', 'b']);
    expect(resolveListOption(undefined, defaults)).not.toBe(defaults);
  });

  it('dedupes object lists by id with consumer entries winning', () => {
    const objDefaults = [
      { id: 'one', value: 'default-one' },
      { id: 'two', value: 'default-two' },
    ];
    const result = resolveListOption(
      [{ id: 'two', value: 'mine-two' }, { id: 'three', value: 'mine-three' }],
      objDefaults,
      (entry) => entry.id
    );

    expect(result).toEqual([
      { id: 'one', value: 'default-one' },
      { id: 'two', value: 'mine-two' },
      { id: 'three', value: 'mine-three' },
    ]);
  });
});

describe('DEFAULT_IGNORE_SELECTORS', () => {
  it('is importable public API and contains the documented entries', () => {
    expect(DEFAULT_IGNORE_SELECTORS).toEqual(
      expect.arrayContaining([
        'script',
        'style',
        'code',
        'com-1password-button',
        'com-1password-menu',
        'com-1password-notification',
        '[id^="1p-"]',
        '[id^="__lpform"]',
        'grammarly-extension',
        'grammarly-desktop-integration',
      ])
    );
  });
});

describe('ignoreSelectors list-option convention', () => {
  let root: HTMLElement;
  let onMissing: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    onMissing = vi.fn().mockResolvedValue(null);
    root = document.createElement('div');
    document.body.innerHTML = '';
    document.body.appendChild(root);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function observe(ignoreSelectors?: string[] | ((d: string[]) => string[])): I18nObserver {
    return new I18nObserver({
      locale: 'es',
      onMissingTranslation: onMissing as never,
      rootElement: root,
      ...(ignoreSelectors === undefined ? {} : { ignoreSelectors }),
    });
  }

  it('unions a plain array with DEFAULT_IGNORE_SELECTORS', async () => {
    root.innerHTML = '<code>Code text</code><div class="mine">Mine text</div><p>Page text</p>';
    const i18n = observe(['.mine']);
    i18n.start();
    await flushDebounce();

    expect(reported(onMissing)).toEqual(['Page text']);
    i18n.stop();
  });

  it('deduplicates when the consumer repeats a default', async () => {
    root.innerHTML = '<code>Code text</code><p>Page text</p>';
    const i18n = observe(['code', '.mine']);
    i18n.start();
    await flushDebounce();

    expect(reported(onMissing)).toEqual(['Page text']);
    i18n.stop();
  });

  it('function form can remove a single default', async () => {
    root.innerHTML =
      '<code>Code text</code><script>Script text</script><div class="immersive">Ext text</div><p>Page text</p>';
    const i18n = observe((d) => [...d.filter((s) => s !== 'code'), '.immersive']);
    i18n.start();
    await flushDebounce();

    expect(reported(onMissing).sort()).toEqual(['Code text', 'Page text']);
    i18n.stop();
  });

  it('function return value is used verbatim — no further merging', async () => {
    root.innerHTML = '<code>Code text</code><div class="only">Only text</div><p>Page text</p>';
    const i18n = observe(() => ['.only']);
    i18n.start();
    await flushDebounce();

    expect(reported(onMissing).sort()).toEqual(['Code text', 'Page text']);
    i18n.stop();
  });

  it('omitting ignoreSelectors entirely still yields the full default list', async () => {
    root.innerHTML =
      '<code>Code text</code><style>Style text</style><script>Script text</script>' +
      '<grammarly-extension>Grammarly text</grammarly-extension>' +
      '<div id="__lpform_x">LastPass text</div>' +
      '<com-1password-button>1P text</com-1password-button><p>Page text</p>';
    const i18n = observe();
    i18n.start();
    await flushDebounce();

    expect(reported(onMissing)).toEqual(['Page text']);
    i18n.stop();
  });

  it('never collects or reports text inside an injected com-1password-menu element', async () => {
    root.innerHTML = '<p>Page text</p>';
    const i18n = observe();
    i18n.start();

    const menu = document.createElement('com-1password-menu');
    menu.textContent = '1Passwordメニューが利用できます。';
    root.appendChild(menu);
    await flushDebounce();

    expect(reported(onMissing)).toEqual(['Page text']);
    expect(menu.hasAttribute('data-i18n-pending')).toBe(false);
    expect(menu.textContent).toBe('1Passwordメニューが利用できます。');
    i18n.stop();
  });

  // Every extension entry names its vendor — a tag or an id prefix — and none matches by
  // shape (`[aria-live]`, `[role=status]`). Worth pinning, because a shape rule is the
  // tempting fix the next time an announcer turns up, and it fails in the one direction
  // nobody sees: the text still reaches screen readers, just never translated. These are
  // the two halves of that decision.
  describe('extension entries match by vendor, never by shape', () => {
    // 1Password's autofill hint arrives in a live region that is NOT a descendant of the
    // com-1password-* elements, so it takes an entry of its own. Present before start()
    // so this asserts the selector, not when the observer happens to see an added node.
    it('ignores 1Password\'s announcer, matched on its vendor id prefix', async () => {
      root.innerHTML =
        '<p>Page text</p><div id="1p-menu-live-region" aria-live="polite">1Passwordメニューが利用できます。</div>';
      const i18n = observe();
      i18n.start();
      await flushDebounce();

      expect(reported(onMissing)).toEqual(['Page text']);
      // Located by exact id, not by the `[id^="1p-"]` selector under test.
      expect(root.querySelector('[id="1p-menu-live-region"]')?.textContent)
        .toBe('1Passwordメニューが利用できます。');
      i18n.stop();
    });

    it('never ignores an app\'s own live region, which is ordinary copy', async () => {
      // Same markup shape, no vendor id — a screen reader reads this aloud, so it has to
      // be translated like any other text. Fails the moment a bare `[aria-live]` (or any
      // other shape rule that catches it) is added to the defaults.
      root.innerHTML = '<div aria-live="polite">Saved</div>';
      const i18n = new I18nObserver({
        locale: 'es',
        onMissingTranslation: onMissing as never,
        rootElement: root,
        initialCache: { 'Saved': 'Guardado' },
      });
      i18n.start();
      await flushDebounce();

      expect(root.querySelector('[aria-live]')?.textContent).toBe('Guardado');
      i18n.stop();
    });
  });
});
