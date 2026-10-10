function createAtmosphereShader() {
  const canvas = document.querySelector('#atmosphere-shader');
  if (!canvas) return { start() {}, stop() {}, setLight() {} };

  const vertexSource = `
    attribute vec2 aPosition;
    varying vec2 vUv;
    void main() {
      vUv = aPosition * 0.5 + 0.5;
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }
  `;
  const fragmentSource = `
    precision mediump float;
    varying vec2 vUv;
    uniform vec2 uResolution;
    uniform float uTime;
    uniform float uLight;

    float hash(vec2 point) {
      return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453);
    }

    float noise(vec2 point) {
      vec2 cell = floor(point);
      vec2 local = fract(point);
      local = local * local * (3.0 - 2.0 * local);
      return mix(
        mix(hash(cell), hash(cell + vec2(1.0, 0.0)), local.x),
        mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0, 1.0)), local.x),
        local.y
      );
    }

    float fbm(vec2 point) {
      float value = 0.0;
      value += noise(point) * 0.55;
      value += noise(point * 2.03) * 0.28;
      value += noise(point * 4.07) * 0.12;
      value += noise(point * 8.11) * 0.05;
      return value;
    }

    void main() {
      vec2 uv = vUv;
      vec2 point = uv - 0.5;
      point.x *= uResolution.x / max(1.0, uResolution.y);

      float beamAxis = point.x + point.y * 0.28;
      float beam = smoothstep(0.38, 0.0, abs(beamAxis));
      beam *= smoothstep(-0.62, 0.25, point.y);
      beam *= 0.5 + 0.5 * noise(vec2(point.x * 3.0, point.y * 2.0 - uTime * 0.06));

      float haze = fbm(uv * vec2(3.1, 2.3) + vec2(0.0, -uTime * 0.012));
      float dustField = fbm(uv * vec2(13.0, 7.0) + vec2(uTime * 0.018, -uTime * 0.026));
      float dust = smoothstep(0.72, 0.92, dustField) * smoothstep(0.66, -0.12, point.y);
      float falloff = smoothstep(0.82, 0.1, length(point * vec2(0.72, 0.86)));
      float glow = (beam * 0.72 + haze * 0.16 + dust * 0.11) * (0.42 + uLight * 0.95) * falloff;
      vec3 amber = vec3(1.0, 0.56, 0.23);
      gl_FragColor = vec4(amber * glow, min(0.23, glow * 0.34));
    }
  `;

  const context = canvas.getContext('webgl', {
    alpha: true,
    antialias: false,
    premultipliedAlpha: false,
    powerPreference: 'low-power',
  });
  if (!context) {
    canvas.hidden = true;
    return { start() {}, stop() {}, setLight() {} };
  }

  const compile = (type, source) => {
    const shader = context.createShader(type);
    if (!shader) return null;
    context.shaderSource(shader, source);
    context.compileShader(shader);
    if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) {
      context.deleteShader(shader);
      return null;
    }
    return shader;
  };
  const vertexShader = compile(context.VERTEX_SHADER, vertexSource);
  const fragmentShader = compile(context.FRAGMENT_SHADER, fragmentSource);
  if (!vertexShader || !fragmentShader) {
    canvas.hidden = true;
    return { start() {}, stop() {}, setLight() {} };
  }
  const program = context.createProgram();
  if (!program) {
    canvas.hidden = true;
    return { start() {}, stop() {}, setLight() {} };
  }
  context.attachShader(program, vertexShader);
  context.attachShader(program, fragmentShader);
  context.linkProgram(program);
  if (!context.getProgramParameter(program, context.LINK_STATUS)) {
    canvas.hidden = true;
    return { start() {}, stop() {}, setLight() {} };
  }

  const buffer = context.createBuffer();
  context.bindBuffer(context.ARRAY_BUFFER, buffer);
  context.bufferData(context.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), context.STATIC_DRAW);
  const position = context.getAttribLocation(program, 'aPosition');
  const time = context.getUniformLocation(program, 'uTime');
  const resolution = context.getUniformLocation(program, 'uResolution');
  const light = context.getUniformLocation(program, 'uLight');
  let frame = 0;
  let active = false;
  let lightLevel = 0.12;
  let startTime = 0;

  const resize = () => {
    const ratio = Math.min(window.devicePixelRatio || 1, 1.6);
    const width = Math.max(1, Math.floor(canvas.clientWidth * ratio));
    const height = Math.max(1, Math.floor(canvas.clientHeight * ratio));
    if (canvas.width === width && canvas.height === height) return;
    canvas.width = width;
    canvas.height = height;
    context.viewport(0, 0, width, height);
  };
  const draw = (now) => {
    frame = 0;
    if (!active) return;
    resize();
    context.clearColor(0, 0, 0, 0);
    context.clear(context.COLOR_BUFFER_BIT);
    context.useProgram(program);
    context.bindBuffer(context.ARRAY_BUFFER, buffer);
    context.enableVertexAttribArray(position);
    context.vertexAttribPointer(position, 2, context.FLOAT, false, 0, 0);
    context.uniform1f(time, (now - startTime) / 1000);
    context.uniform2f(resolution, canvas.width, canvas.height);
    context.uniform1f(light, lightLevel);
    context.drawArrays(context.TRIANGLE_STRIP, 0, 4);
    if (!document.documentElement.classList.contains('reduced')) frame = requestAnimationFrame(draw);
  };
  const resizeObserver = 'ResizeObserver' in window ? new ResizeObserver(resize) : null;
  resizeObserver?.observe(canvas);
  window.addEventListener('resize', resize, { passive: true });
  context.enable(context.BLEND);
  context.blendFunc(context.SRC_ALPHA, context.ONE_MINUS_SRC_ALPHA);

  return {
    setLight(value) { lightLevel = Math.max(0.04, Math.min(1, Number(value) || 0)); },
    start(staticFrame = false) {
      active = true;
      startTime = performance.now();
      resize();
      if (staticFrame) draw(startTime);
      else if (!frame) frame = requestAnimationFrame(draw);
    },
    stop() {
      active = false;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    },
  };
}

export function initIntro() {
  const scene = document.querySelector('#intro');
  const video = document.querySelector('#opening');
  const status = document.querySelector('#intro-status');
  const sound = document.querySelector('#sound');
  const skip = document.querySelector('#skip');
  const replay = document.querySelector('#replay');
  const main = document.querySelector('#main');
  if (!scene || !video || !status || !sound || !skip) return;

  let finishTimer;
  let hideTimer;
  let lightTimer;
  let previousFocus;
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 8;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('reduced');
  const atmosphere = createAtmosphereShader();
  const setSoundState = (enabled) => {
    sound.textContent = enabled ? 'Mute sound' : 'Enable sound';
    sound.setAttribute('aria-pressed', String(enabled));
  };
  const setInert = (value) => {
    for (const element of document.querySelectorAll('.header, main, footer, .horizon-nav')) element.inert = value;
  };

  function finish() {
    clearTimeout(finishTimer);
    clearTimeout(hideTimer);
    clearInterval(lightTimer);
    video.pause();
    atmosphere.stop();
    scene.classList.add('leaving');
    document.body.classList.remove('intro-active');
    document.dispatchEvent(new Event('lumetra-intro-end'));
    setInert(false);
    if (replay) replay.setAttribute('aria-expanded', 'false');
    hideTimer = setTimeout(() => { scene.hidden = true; }, reduced() ? 0 : 750);
    (previousFocus || main).focus({ preventScroll: true });
  }

  function sampleProjectionLight() {
    if (video.paused || video.readyState < 2 || reduced() || !context) return;
    try {
      context.drawImage(video, 0, 0, 8, 8);
      const pixels = context.getImageData(0, 0, 8, 8).data;
      let light = 0;
      for (let index = 0; index < pixels.length; index += 4) light += (pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3;
      const normalized = light / (64 * 255);
      scene.style.setProperty('--spill', String(.035 + normalized * .2));
      atmosphere.setLight(normalized);
    } catch {
      // Some browsers refuse canvas sampling of media. The static spill remains the fallback.
    }
  }

  async function play() {
    clearTimeout(finishTimer);
    clearTimeout(hideTimer);
    clearInterval(lightTimer);
    previousFocus = document.activeElement === document.body ? main : document.activeElement;
    scene.hidden = false;
    scene.classList.remove('leaving');
    atmosphere.start(reduced() || navigator.connection?.saveData);
    document.body.classList.add('intro-active');
    setInert(true);
    if (replay) replay.setAttribute('aria-expanded', 'true');
    video.currentTime = 0;
    video.muted = false;
    setSoundState(true);
    status.textContent = 'Original opening film · 10 seconds';
    skip.focus({ preventScroll: true });

    if (navigator.connection?.saveData || reduced()) {
      status.textContent = 'Reduced motion is on. Enter when you are ready.';
      setSoundState(false);
      return;
    }
    try {
      await video.play();
    } catch {
      video.muted = true;
      setSoundState(false);
      try {
        await video.play();
      } catch {
        status.textContent = 'Press Enable sound to start the opening, or skip to explore.';
      }
    }
    finishTimer = setTimeout(finish, 19000);
    lightTimer = setInterval(sampleProjectionLight, 220);
  }

  sound.onclick = async () => {
    if (video.paused) {
      video.muted = false;
      try {
        await video.play();
        setSoundState(true);
        status.textContent = 'Original opening film · 10 seconds';
        clearTimeout(finishTimer);
        finishTimer = setTimeout(finish, 15000);
      } catch {
        status.textContent = 'Playback is unavailable. Skip to enter the archive.';
      }
      return;
    }
    video.muted = !video.muted;
    setSoundState(!video.muted);
  };
  skip.onclick = finish;
  video.onended = finish;
  video.onerror = () => {
    status.textContent = 'Opening film unavailable. Entering the archive…';
    finishTimer = setTimeout(finish, 1800);
  };
  scene.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); finish(); }
    if (event.key === 'Tab') {
      const focusable = [sound, skip];
      if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable[1].focus(); }
      else if (!event.shiftKey && document.activeElement === focusable[1]) { event.preventDefault(); focusable[0].focus(); }
    }
  });
  replay?.addEventListener('click', play);
  play();
}
