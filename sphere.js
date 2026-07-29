/* Fullscreen ethereal nebula planet — vanilla JS port of the DC prototype.
   Drop-in replacement for the old sphere.js. Requires the CSS block below
   and no HTML changes beyond what's noted. */
(() => {
  const wrap = document.getElementById('sphere');
  if (!wrap) return;
  const canvas = wrap.querySelector('canvas');
  const gl = canvas.getContext('webgl', { alpha: true, antialias: true });
  if (!gl) return;

  const VERT = `attribute vec2 a;
void main() { gl_Position = vec4(a, 0.0, 1.0); }`;

  const FRAG = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_yaw;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - u_res) / (u_res.y * 0.62);
  float r = length(uv);
  float z = sqrt(max(0.0, 1.0 - min(r, 1.0) * min(r, 1.0)));
  vec3 n = vec3(uv, z);
  float cp = cos(0.35), sp = sin(0.35);
  vec3 q = vec3(n.x, n.y * cp - n.z * sp, n.y * sp + n.z * cp);
  float cy = cos(u_yaw), sy = sin(u_yaw);
  vec3 p = vec3(q.x * cy + q.z * sy, q.y, -q.x * sy + q.z * cy);
  float nb = fbm(p * 1.8 + vec3(0.0, 0.0, u_time * 0.025));
  float nb2 = fbm(p * 3.6 + 7.3);
  float dens = smoothstep(0.3, 0.9, nb);
  vec3 base = vec3(0.5, 0.22, 0.4);
  vec3 cloud = vec3(1.0, 0.55, 0.75);
  vec3 core = vec3(1.0, 0.8, 0.9);
  vec3 wisp = vec3(0.62, 0.45, 0.85);
  vec3 col = mix(base, cloud, dens);
  col = mix(col, core, smoothstep(0.6, 0.95, nb));
  col = mix(col, wisp, smoothstep(0.55, 0.9, nb2) * 0.3);
  col *= 1.35;
  vec3 sp3 = p * 22.0;
  float star = step(0.992, hash(floor(sp3)));
  float glow = star * smoothstep(0.42, 0.0, length(fract(sp3) - 0.5));
  col += vec3(1.0, 0.96, 0.9) * glow * 0.8;
  float fres = pow(1.0 - z, 2.4);
  float ang = atan(uv.y, uv.x);
  vec3 rainbow = 0.5 + 0.5 * cos(ang * 2.0 + vec3(0.0, 2.1, 4.2) + u_time * 0.15);
  vec3 rim = 0.4 * rainbow + vec3(0.22);
  col += fres * rim * smoothstep(1.3, 0.7, r);
  float spec = pow(max(dot(n, normalize(vec3(-0.5, 0.6, 0.7))), 0.0), 42.0) * step(r, 1.0);
  col += spec * 0.5;
  float edgeFeather = smoothstep(1.55, 0.5, r);
  float haze = dens * 0.35 * smoothstep(1.9, 0.85, r);
  float a = clamp((0.22 + 0.5 * fres * step(r,1.05) + dens * 0.55 + glow * 0.8 + spec) * edgeFeather + haze, 0.0, 0.85);
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
  wrap.classList.add('gl');

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const AUTO_SPEED = reduced ? 0 : 0.045;
  let yaw = 0, last = performance.now(), scrollYaw = 0;

  // scroll-driven: hero layout puts text left, planet right (~74% viewport width),
  // shrinks + fades out ~0.85 viewport-heights into the scroll, gentle parallax drift.
  const BASE_SCALE = 0.62;
  function applyScrollTransform() {
    const y = window.scrollY;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const mobile = vw <= 700;
    // shader draws the planet at 0.62 × canvas height; in portrait that reads as a
    // wall of glow, so on mobile pick the scale from the viewport width instead
    const canvasH = canvas.clientHeight || vh * 1.4;
    const scale = mobile ? (vw * 0.85) / (0.62 * canvasH) : BASE_SCALE;
    const baseX = mobile ? 0 : vw * 0.24; // centered behind the hero on small screens
    const baseY = mobile ? -vh * 0.1 : vh * 0.08; // sits up behind the name on mobile
    const maxOpacity = mobile ? 0.55 : 1; // dimmed where text overlaps it
    const t = Math.min(Math.max(y / (vh * 0.85), 0), 1);
    canvas.style.opacity = String(maxOpacity * (1 - t * 0.9));
    canvas.style.transform = `translate(${baseX}px, ${baseY + y * 0.06}px) scale(${scale * (1 - t * 0.3)})`;
    scrollYaw = y * 0.00035;
  }
  window.addEventListener('scroll', applyScrollTransform, { passive: true });
  window.addEventListener('resize', applyScrollTransform);
  applyScrollTransform();

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
  }
  window.addEventListener('resize', resize);
  resize();

  function draw(now) {
    requestAnimationFrame(draw);
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    yaw += AUTO_SPEED * dt;
    resize();
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, reduced ? 0 : now / 1000);
    gl.uniform1f(uYaw, yaw + scrollYaw);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  requestAnimationFrame(draw);
})();
