const $ = (s) => document.querySelector(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);

const MAX_CRACKS = 14;
const SVG_NS = 'http://www.w3.org/2000/svg';

let data;
let running = true;
let crackCount = 0;
let bubbleShown = false;
let audio;

// ---------- 声音:用 WebAudio 合成,不依赖音频文件 ----------

function thump(t, from, to, dur, gain) {
  const osc = audio.createOscillator();
  const g = audio.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(to, t + dur * 0.7);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(audio.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function knockSound(withGlass, heavy) {
  if (!data.sound || data.volume <= 0) return;
  audio ||= new AudioContext();
  const t = audio.currentTime;
  const vol = data.volume;

  // 低频"咚"
  thump(t, 190, 55, 0.24, vol);
  // 重拳再叠一层更低更长的轰鸣
  if (heavy) thump(t, 95, 32, 0.42, vol * 0.9);

  // 指节敲玻璃的"哒"
  noise(t, 0.05, 'bandpass', 1700, vol * 0.8);
  // 裂开时再加一点高频碎裂声
  if (withGlass) noise(t + 0.01, heavy ? 0.22 : 0.12, 'highpass', 4200, vol * (heavy ? 0.5 : 0.35));
}

function noise(t, dur, type, freq, gain) {
  const len = Math.floor(audio.sampleRate * dur);
  const buf = audio.createBuffer(1, len, audio.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const src = audio.createBufferSource();
  src.buffer = buf;
  const f = audio.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = 0.9;
  const g = audio.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(audio.destination);
  src.start(t);
}

// ---------- 玻璃裂纹 ----------

const p = (x, y) => `${x.toFixed(1)} ${y.toFixed(1)}`;

function addCrack(x, y) {
  const scale = rand(0.7, 1.25);
  const rays = 8 + Math.floor(Math.random() * 6);
  const pts = [];
  let d = '';

  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2 + rand(-0.25, 0.25);
    const len = rand(90, 300) * scale;
    const segs = 4 + Math.floor(Math.random() * 3);
    const ray = [[x, y]];
    for (let s = 1; s <= segs; s++) {
      const r = (len * s) / segs;
      const j = rand(-0.18, 0.18);
      ray.push([x + Math.cos(a + j) * r, y + Math.sin(a + j) * r]);
    }
    pts.push(ray);
    d += 'M' + ray.map(([px, py]) => p(px, py)).join(' L');

    // 偶尔分个叉
    if (Math.random() < 0.55) {
      const [bx, by] = ray[2 + Math.floor(Math.random() * (segs - 2))];
      const ba = a + (Math.random() < 0.5 ? -1 : 1) * rand(0.4, 0.9);
      const bl = len * rand(0.18, 0.4);
      d += `M${p(bx, by)} L${p(bx + Math.cos(ba) * bl, by + Math.sin(ba) * bl)}`;
    }
  }

  // 两圈不规则的环形裂纹,把相邻射线连起来
  for (const ring of [1, 2]) {
    for (let i = 0; i < rays; i++) {
      if (Math.random() < 0.3) continue;
      const A = pts[i][ring];
      const B = pts[(i + 1) % rays][ring];
      d += `M${p(A[0], A[1])} L${p(B[0], B[1])}`;
    }
  }

  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', 'crack');
  g.style.transformOrigin = `${x}px ${y}px`;
  g.innerHTML = `
    <path d="${d}" fill="none" stroke="rgba(0,0,0,.55)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${d}" fill="none" stroke="rgba(255,255,255,.95)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${x}" cy="${y}" r="${(10 * scale).toFixed(1)}" fill="rgba(255,255,255,.55)" stroke="rgba(0,0,0,.4)" stroke-width="1.5"/>`;
  $('#cracks').appendChild(g);
}

// ---------- 敲击动画 ----------

let sprite = null; // 精灵图形象:{ canvas, ctx, img, cell, cols, idle, combo }

function drawFrame(i) {
  const { ctx, canvas, img, cell, cols } = sprite;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, (i % cols) * cell, Math.floor(i / cols) * cell, cell, cell, 0, 0, canvas.width, canvas.height);
}

// "镜头":整个形象的缩放/位移,蓄力时往后退,砸中时猛地冲向屏幕再回弹
let camAnim = null;
function cam(keyframes, opts) {
  camAnim?.cancel();
  camAnim = $('#figure').animate(keyframes, { fill: 'forwards', ...opts });
}

async function playIdle(ms) {
  const end = performance.now() + ms;
  for (let k = 0; running && performance.now() < end; k = (k + 1) % sprite.idle.length) {
    const [f, d] = sprite.idle[k];
    drawFrame(f);
    await sleep(d);
  }
}

async function playCombo() {
  const { combo, canvas } = sprite;
  for (let k = 0; k < combo.length && running; k++) {
    const [f, d, cue, fx, fy] = combo[k];
    drawFrame(f);
    if (cue === 'windup') {
      // 蓄力时长 = 到下一个 hit 之前的帧时长之和,镜头在这段时间里慢慢后退
      let pull = 0;
      for (let j = k; j < combo.length && combo[j][2] !== 'hit'; j++) pull += combo[j][1];
      cam([{ transform: 'none' }, { transform: 'scale(0.94) translate(2%, 2%)' }], { duration: pull, easing: 'cubic-bezier(.2,.7,.4,1)' });
    }
    if (cue === 'hit') {
      cam(
        [{ transform: 'scale(1.2) translate(-4%, -3%)' }, { transform: 'scale(0.98) translate(0.5%, 0.5%)', offset: 0.55 }, { transform: 'none' }],
        { duration: 340, easing: 'cubic-bezier(.15,.85,.35,1)' }
      );
      // 镜头放大后再量拳头位置,裂纹才能落在拳头上
      await new Promise(requestAnimationFrame);
      const r = canvas.getBoundingClientRect();
      impact(r.left + r.width * fx + rand(-20, 20), r.top + r.height * fy + rand(-20, 20), true);
    }
    await sleep(d);
  }
}

// 自定义图片没有动作帧,整个身子往屏幕上撞
async function bodySlam() {
  cam([{ transform: 'none' }, { transform: 'translateY(2vh) scale(0.94)' }], { duration: 160, easing: 'ease-out' });
  await sleep(160);
  cam([{ transform: 'translateY(-4vh) scale(1.16)' }, { transform: 'none' }], { duration: 300, easing: 'cubic-bezier(.15,.85,.35,1)' });
  await new Promise(requestAnimationFrame);
  const r = $('#figure').getBoundingClientRect();
  impact(r.left + r.width / 2 + rand(-80, 80), r.top + r.height * 0.3 + rand(-40, 40), false);
  await sleep(300);
}

function impact(x, y, heavy) {
  const glass = crackCount < MAX_CRACKS && (heavy || crackCount < 3 || Math.random() < 0.6);
  if (glass) {
    addCrack(x, y);
    crackCount++;
  }
  knockSound(glass, heavy);

  // 震屏
  const shaker = $('#shaker');
  const cls = heavy ? 'shake-heavy' : 'shake';
  shaker.classList.remove('shake', 'shake-heavy');
  void shaker.offsetWidth;
  shaker.classList.add(cls);

  // 冲击白光:拳头处一团强光,重击时整屏再闪一下
  const flash = $('#flash');
  const spot = `radial-gradient(circle at ${x}px ${y}px, rgba(255,255,255,.85), rgba(255,255,255,0) ${heavy ? 380 : 260}px)`;
  flash.style.background = heavy ? `${spot}, rgba(255,255,255,.22)` : spot;
  flash.animate([{ opacity: 1 }, { opacity: 0 }], { duration: heavy ? 280 : 220, easing: 'ease-out' });

  // 咚!
  const bang = document.createElement('div');
  bang.className = 'bang';
  bang.textContent = ['咚!', '咚咚!', '哐!', '砰!'][Math.floor(Math.random() * 4)];
  bang.style.left = `${x + rand(40, 140)}px`;
  bang.style.top = `${y - 40}px`;
  bang.style.setProperty('--r', `${rand(-18, 18)}deg`);
  $('#bangs').appendChild(bang);
  setTimeout(() => bang.remove(), 850);
}

async function knockLoop() {
  while (running) {
    if (sprite) {
      await playCombo();
    } else {
      for (let i = 0; i < 3 && running; i++) await bodySlam();
    }
    if (!bubbleShown) {
      bubbleShown = true;
      $('#bubble').classList.remove('hidden');
      $('#done').focus();
    }
    if (sprite) await playIdle(1500);
    else await sleep(1500);
  }
}

// ---------- 关闭 ----------

let leaving = false;
async function leave(action) {
  if (leaving) return;
  leaving = true;
  running = false;
  document.body.classList.add('leaving');
  $('#buddy').animate([{ transform: 'translateY(0)' }, { transform: 'translateY(120%)' }], {
    duration: 320,
    easing: 'cubic-bezier(.6,-0.3,.7,1)',
    fill: 'forwards',
  });
  await sleep(340);
  action === 'snooze' ? window.api.snooze() : window.api.done();
}

function startCountdown(sec) {
  if (!sec) return;
  const el = $('#countdown');
  let left = sec;
  const render = () => (el.textContent = `${left} 秒后自动收起`);
  render();
  const timer = setInterval(() => {
    left--;
    if (left <= 0) {
      clearInterval(timer);
      leave('done');
    } else render();
  }, 1000);
}

// ---------- 启动 ----------

(async function init() {
  data = await window.api.overlayData();
  if (!data) return window.api.done();

  document.body.classList.toggle('dim', data.dim);
  $('#title').textContent = data.title;
  $('#message').textContent = data.message;
  $('#snooze').textContent = `${data.snoozeMin} 分钟后再敲`;

  const figure = $('#figure');
  if (data.character.type === 'sprite') {
    const meta = data.character.value;
    const img = new Image();
    img.src = meta.sheet;
    await img.decode();
    const cell = img.naturalWidth / meta.cols;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = Math.round(cell * 3);
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    figure.classList.add('sprite');
    figure.appendChild(canvas);
    sprite = { canvas, ctx, img, cell, cols: meta.cols, idle: meta.idle, combo: meta.combo };
    drawFrame(meta.idle[0][0]);
  } else {
    const img = document.createElement('img');
    img.src = data.character.value;
    img.draggable = false;
    figure.appendChild(img);
  }

  $('#done').addEventListener('click', () => leave('done'));
  $('#snooze').addEventListener('click', () => leave('snooze'));
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Enter') leave('done');
  });

  // 从屏幕下方冒出来
  await $('#buddy').animate(
    [{ transform: 'translateY(110%)' }, { transform: 'translateY(-6%)', offset: 0.75 }, { transform: 'translateY(0)' }],
    { duration: 650, easing: 'cubic-bezier(.2,.9,.3,1)' }
  ).finished;

  startCountdown(data.autoCloseSec);
  if (sprite) await playIdle(400); // 先瞪一眼再动手
  knockLoop();
})();
