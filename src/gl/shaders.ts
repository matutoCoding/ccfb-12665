// GLSL 着色器 (WebGL2 / GLSL ES 3.00)

export const TERRAIN_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNormal;
uniform mat4 uMVP;
uniform vec2 uElevRange;
out vec3 vNormal;
out vec3 vPos;
out float vElev;
void main() {
  vNormal = aNormal;
  vPos = aPos;
  vElev = (aPos.z - uElevRange.x) / max(1.0, uElevRange.y - uElevRange.x);
  gl_Position = uMVP * vec4(aPos, 1.0);
}`;

export const TERRAIN_FS = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vPos;
in float vElev;
uniform vec3 uLightDir;
uniform sampler2D uOverlay;
uniform int uUseOverlay;
uniform vec2 uOverlayOrigin;
uniform vec2 uOverlaySize;
uniform vec3 uCamPos;
uniform float uFogDist;
out vec4 frag;
vec3 elevColor(float t) {
  vec3 c1 = vec3(0.22, 0.48, 0.24);  // 低谷绿
  vec3 c2 = vec3(0.58, 0.52, 0.34);  // 坡地褐
  vec3 c3 = vec3(0.85, 0.83, 0.78);  // 山脊灰白
  vec3 c = mix(c1, c2, smoothstep(0.0, 0.55, t));
  return mix(c, c3, smoothstep(0.55, 1.0, t));
}
void main() {
  vec3 n = normalize(vNormal);
  float diff = max(dot(n, normalize(uLightDir)), 0.0);
  float sky = 0.5 + 0.5 * n.z;  // 半球环境光
  vec3 base = elevColor(clamp(vElev, 0.0, 1.0));
  vec3 col = base * (0.30 + 0.30 * sky + 0.55 * diff);
  if (uUseOverlay == 1) {
    vec2 uv = (vPos.xy - uOverlayOrigin) / uOverlaySize;
    if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) {
      vec4 oc = texture(uOverlay, uv);
      col = mix(col, oc.rgb * (0.5 + 0.5 * diff), oc.a * 0.72);
    }
  }
  float dist = length(vPos - uCamPos);
  float fog = 1.0 - exp(-pow(dist / uFogDist, 2.0));
  col = mix(col, vec3(0.55, 0.62, 0.70), clamp(fog, 0.0, 0.75));
  frag = vec4(col, 1.0);
}`;

// 机组/房屋等实例化网格。局部坐标: 塔筒沿 +Z, 轮毂中心在原点(叶片/机舱), 塔筒 z∈[0,1]
export const MESH_VS = `#version 300 es
layout(location=0) in vec3 aPos;     // 局部坐标
layout(location=1) in vec3 aNormal;
layout(location=2) in vec2 aKind;    // x: 0塔筒 1机舱/附件 2叶片; y: 叶片基准角
layout(location=3) in vec3 iPos;     // 实例: 基础位置(世界)
layout(location=4) in vec3 iScale;   // x: 叶轮直径 y: 轮毂高 z: 备用
layout(location=5) in vec2 iYawPhase;
layout(location=6) in float iFlag;   // 0 正常 1 选中高亮 2 候选(半透明绿)
uniform mat4 uMVP;
uniform float uTime;
out vec3 vNormal;
out vec3 vPos;
out float vFlag;
void main() {
  float rotorD = iScale.x;
  float hubH = iScale.y;
  vec3 p = aPos;
  vec3 n = aNormal;
  if (aKind.x > 1.5) {
    // 叶片: 绕 X 轴(机舱轴)旋转
    float ang = aKind.y + uTime * 1.6 + iYawPhase.y;
    float c = cos(ang), s = sin(ang);
    p = vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z);
    n = vec3(n.x, c * n.y - s * n.z, s * n.y + c * n.z);
    p *= rotorD;
    p += vec3(0.055 * rotorD, 0.0, hubH);
  } else if (aKind.x > 0.5) {
    p = p * rotorD + vec3(0.0, 0.0, hubH);
  } else {
    p = vec3(p.xy * rotorD, p.z * hubH);
  }
  // 偏航(绕 Z)
  float cy = cos(iYawPhase.x), sy = sin(iYawPhase.x);
  p = vec3(cy * p.x - sy * p.y, sy * p.x + cy * p.y, p.z);
  n = vec3(cy * n.x - sy * n.y, sy * n.x + cy * n.y, n.z);
  vec3 world = p + iPos;
  vNormal = n;
  vPos = world;
  vFlag = iFlag;
  gl_Position = uMVP * vec4(world, 1.0);
}`;

export const MESH_FS = `#version 300 es
precision highp float;
in vec3 vNormal;
in vec3 vPos;
in float vFlag;
uniform vec3 uLightDir;
uniform vec3 uBaseColor;
out vec4 frag;
void main() {
  vec3 n = normalize(vNormal);
  float diff = max(dot(n, normalize(uLightDir)), 0.0);
  vec3 col = uBaseColor;
  if (vFlag > 1.5) col = vec3(0.3, 0.95, 0.5);
  else if (vFlag > 0.5) col = vec3(1.0, 0.75, 0.25);
  vec3 c = col * (0.35 + 0.75 * diff) + vec3(0.08) * pow(max(dot(n, normalize(uLightDir + vec3(0,0,1))), 0.0), 8.0);
  frag = vec4(c, 1.0);
}`;

export const LINE_VS = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aColor;
uniform mat4 uMVP;
out vec3 vColor;
void main() {
  vColor = aColor;
  gl_Position = uMVP * vec4(aPos, 1.0);
}`;

export const LINE_FS = `#version 300 es
precision highp float;
in vec3 vColor;
out vec4 frag;
void main() { frag = vec4(vColor, 1.0); }`;
