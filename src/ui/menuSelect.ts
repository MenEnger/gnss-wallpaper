import type { OptionController } from 'lil-gui';

/** lil-gui の OptionController の内部（公開型に無いもの） */
interface OptionInternals {
  $select: HTMLSelectElement;
  $widget: HTMLElement;
  _values: unknown[];
  _names: string[];
}

let openMenu: { el: HTMLElement; close: () => void } | null = null;

function closeOpenMenu(): void {
  openMenu?.close();
}

window.addEventListener('pointerdown', (e) => {
  if (openMenu && !openMenu.el.contains(e.target as Node)) closeOpenMenu();
}, true);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeOpenMenu();
});
window.addEventListener('resize', closeOpenMenu);

/**
 * セレクトボックスの選択肢を、OS のネイティブポップアップではなくページ内のリストで表示する。
 * Lively Wallpaper などの壁紙ホストではマウス入力がページにしか転送されず、
 * ネイティブポップアップをクリックで確定できないため。キーボード操作は従来どおり <select> で行える。
 */
export function useInPageMenu(ctrl: OptionController): void {
  const c = ctrl as unknown as OptionInternals;
  c.$select.style.pointerEvents = 'none';
  c.$widget.style.cursor = 'pointer';

  c.$widget.addEventListener('click', (e) => {
    e.stopPropagation();
    if (ctrl._disabled) return;
    const wasOpenHere = openMenu?.el.dataset.owner === ctrl.property;
    closeOpenMenu();
    if (wasOpenHere) return;

    const menu = document.createElement('div');
    menu.className = 'in-page-menu';
    menu.dataset.owner = ctrl.property;
    const current = ctrl.getValue();
    c._names.forEach((name, i) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.textContent = name;
      if (c._values[i] === current) item.classList.add('selected');
      item.addEventListener('click', (ev) => {
        ev.stopPropagation();
        ctrl.setValue(c._values[i]);
        closeOpenMenu();
      });
      menu.appendChild(item);
    });

    const r = c.$widget.getBoundingClientRect();
    menu.style.left = `${r.left}px`;
    menu.style.minWidth = `${r.width}px`;
    document.body.appendChild(menu);
    // 下に収まらなければ上に開く
    const h = menu.offsetHeight;
    menu.style.top = r.bottom + h + 4 > window.innerHeight ? `${Math.max(4, r.top - h - 2)}px` : `${r.bottom + 2}px`;

    openMenu = {
      el: menu,
      close: () => {
        menu.remove();
        openMenu = null;
      },
    };
  });
}
