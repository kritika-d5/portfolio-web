/* Interactive glassy space sphere (dark mode hero).
   Raw WebGL fragment shader: procedural nebula + stars + prismatic rim.
   Drag to spin; falls back to the CSS gradient sphere if WebGL is unavailable. */
(() => {
  const wrap = document.getElementById('sphere');
  if (!wrap) return;
  const canvas = wrap.querySelector('canvas');
  const gl = canvas.getContext('webgl', { alpha: true, antialias: true, preserveDrawingBuffer: true });
  if (!gl) return;

  const VERT = `
attribute vec2 a;
void main() { gl_Position = vec4(a, 0.0, 1.0); }`;

  const FRAG = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_yaw;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
                 mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                 mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - u_res) / u_res.y;
  float r = length(uv);
  if (r > 1.0) { gl_FragColor = vec4(0.0); return; }
  float edge = smoothstep(1.0, 0.98, r);
  float z = sqrt(max(0.0, 1.0 - r * r));
  vec3 n = vec3(uv, z);

  // fixed gentle tilt, then user/auto yaw
  float cp = cos(0.35), sp = sin(0.35);
  vec3 q = vec3(n.x, n.y * cp - n.z * sp, n.y * sp + n.z * cp);
  float cy = cos(u_yaw), sy = sin(u_yaw);
  vec3 p = vec3(q.x * cy + q.z * sy, q.y, -q.x * sy + q.z * cy);

  // nebula layers — soft pink, low contrast
  float nb = fbm(p * 1.8 + vec3(0.0, 0.0, u_time * 0.03));
  float nb2 = fbm(p * 3.6 + 7.3);
  float dens = smoothstep(0.3, 0.9, nb);
  vec3 col = mix(vec3(0.5, 0.22, 0.4), vec3(1.0, 0.55, 0.75), dens);
  col = mix(col, vec3(1.0, 0.8, 0.9), smoothstep(0.6, 0.95, nb));
  col = mix(col, vec3(0.62, 0.45, 0.85), smoothstep(0.55, 0.9, nb2) * 0.25);

  // star specks rotating with the surface
  vec3 sp3 = p * 22.0;
  float star = step(0.992, hash(floor(sp3)));
  float glow = star * smoothstep(0.42, 0.0, length(fract(sp3) - 0.5));
  col += vec3(1.0, 0.96, 0.9) * glow * 0.9;

  // prismatic fresnel rim (chromatic dispersion)
  float fres = pow(1.0 - z, 2.5);
  float ang = atan(uv.y, uv.x);
  vec3 rainbow = 0.5 + 0.5 * cos(ang * 2.0 + vec3(0.0, 2.1, 4.2) + u_time * 0.15);
  col += fres * (0.38 * rainbow + 0.22);

  // glassy speculars
  float spec = pow(max(dot(n, normalize(vec3(-0.5, 0.6, 0.7))), 0.0), 42.0);
  col += spec * 0.55;
  col += pow(max(dot(n, normalize(vec3(-0.6, 0.7, 0.4))), 0.0), 8.0) * 0.1;

  // glass transparency: airy center, denser prismatic rim
  float a = edge * clamp(0.1 + 0.55 * fres + dens * 0.45 + glow * 0.8 + spec, 0.0, 0.9);
  gl_FragColor = vec4(col * a, a);
}`;

  function shader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) return null;
    return s;
  }
  const vs = shader(gl.VERTEX_SHADER, VERT);
  const fs = shader(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return;
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'a');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const uRes = gl.getUniformLocation(prog, 'u_res');
  const uTime = gl.getUniformLocation(prog, 'u_time');
  const uYaw = gl.getUniformLocation(prog, 'u_yaw');

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);

  // shader is live: swap the CSS-gradient look for the GL render
  wrap.classList.add('gl');

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const AUTO_SPEED = reduced ? 0 : 0.12; // rad/s
  let yaw = 0, vel = 0, dragging = false, lastX = 0, last = performance.now();

  wrap.addEventListener('pointerdown', e => {
    dragging = true;
    lastX = e.clientX;
    wrap.setPointerCapture(e.pointerId);
    wrap.classList.add('grabbing');
  });
  wrap.addEventListener('pointermove', e => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    lastX = e.clientX;
    vel = dx * 0.012;
    yaw += vel;
  });
  const release = () => { dragging = false; wrap.classList.remove('grabbing'); };
  wrap.addEventListener('pointerup', release);
  wrap.addEventListener('pointercancel', release);

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = wrap.clientWidth;
    if (canvas.width !== size * dpr) {
      canvas.width = canvas.height = size * dpr;
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
  }

  function frame(now) {
    requestAnimationFrame(frame);
    draw(now);
  }

  function draw(now) {
    if (wrap.offsetParent === null) return; // hidden (light mode)
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (!dragging) {
      vel *= 0.94;                       // inertia decay
      yaw += vel + AUTO_SPEED * dt;      // settle back to slow auto-spin
    }
    resize();
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, reduced ? 0 : now / 1000);
    gl.uniform1f(uYaw, yaw);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  draw(performance.now()); // paint first frame immediately
  requestAnimationFrame(frame);
})();
