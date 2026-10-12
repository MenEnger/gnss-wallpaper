/**
 * 押下（pointerdown）だけ届いて解放（pointerup）が届かない場合の保険。
 *
 * Lively Wallpaper などの壁紙ホストはマウス入力を転送するが、デスクトップ上の別の場所で
 * ボタンを離すと pointerup がページに届かないことがある。すると OrbitControls や
 * lil-gui のスライダーがドラッグ中のまま残り、カーソルを動かすだけで地球が回ってしまう。
 *
 * ドラッグ中に左ボタンが押されていない移動を検出したら、取りこぼした pointerup を補って終了させる。
 *
 * Lively の場合（lively-community/lively の WinDesktopCore.cs / InputUtil.cs で確認）:
 * - 押下・解放はデスクトップが前面のときだけ転送される。別ウィンドウのタイトルバーを押した瞬間は
 *   まだデスクトップが前面なので押下だけが届き、離したときには転送されない。
 * - 移動は常に転送されるが、wParam が MK_MOVE(0x20) 固定で、これは MK_XBUTTON1 と同じ値。
 *   そのためページからは常に「戻るボタンだけ押されている」移動（buttons = 8）に見え、
 *   左ボタンの状態は分からない。
 * よって左ボタンのビットで判定する。結果として Lively 上ではドラッグによる視点操作はできないが
 * （自動周回のみ）、ドラッグ状態が取り残されることはなくなる。通常のブラウザには影響しない。
 */
export function installInputGuard(): void {
  let down: { target: EventTarget; pointerId: number } | null = null;

  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType === 'mouse' && e.target) down = { target: e.target, pointerId: e.pointerId };
    },
    true,
  );

  const clear = (e: PointerEvent) => {
    if (down && e.pointerId === down.pointerId) down = null;
  };
  window.addEventListener('pointerup', clear, true);
  window.addEventListener('pointercancel', clear, true);

  window.addEventListener(
    'pointermove',
    (e) => {
      if (!down || e.pointerId !== down.pointerId || (e.buttons & 1) !== 0) return;
      // この移動は回転などに使わせない
      e.stopImmediatePropagation();
      const { target } = down;
      down = null;
      target.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          cancelable: true,
          composed: true,
          pointerId: e.pointerId,
          pointerType: e.pointerType,
          isPrimary: e.isPrimary,
          clientX: e.clientX,
          clientY: e.clientY,
          screenX: e.screenX,
          screenY: e.screenY,
          button: 0,
          buttons: 0,
        }),
      );
    },
    true,
  );
}
