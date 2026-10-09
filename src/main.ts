import { Game } from './game';
import { Hud } from './hud';
import { render } from './render';
import { VIEW_W, VIEW_H } from './view';
import { unlockAudio } from './audio';

const stage = document.getElementById('stage')!;
const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const game = new Game(stage, canvas);
const hud = new Hud(document.getElementById('hud')!, document.getElementById('tuning')!, game);
game.ui = hud;

let scale = 1;
function resize() {
  scale = Math.min(window.innerWidth / VIEW_W, window.innerHeight / VIEW_H);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  stage.style.transform = `translate(${(window.innerWidth - VIEW_W * scale) / 2}px, ${(window.innerHeight - VIEW_H * scale) / 2}px) scale(${scale})`;
  canvas.width = Math.round(VIEW_W * scale * dpr);
  canvas.height = Math.round(VIEW_H * scale * dpr);
  ctx.setTransform((canvas.width / VIEW_W), 0, 0, (canvas.height / VIEW_H), 0, 0);
}
window.addEventListener('resize', resize);
resize();

window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('keydown', unlockAudio);

hud.showStart();
hud.rebuildPanels();

// fixed-step simulation, render every frame
const STEP = 1 / 60;
let acc = 0;
let last = performance.now();
function frame(now: number) {
  acc += Math.min(0.1, (now - last) / 1000);
  last = now;
  while (acc >= STEP) { game.update(STEP); acc -= STEP; }
  ctx.setTransform(canvas.width / VIEW_W, 0, 0, canvas.height / VIEW_H, 0, 0);
  render(ctx, game);
  hud.update();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// handy in the console while tuning
(window as any).game = game;
