/**
 * The CRT effect: the game canvas as a colour monitor of the ST's showed it, a curved tube
 * whose beam draws each of the 200 lines with a dark gap between them.
 *
 * It is drawn on a canvas of its own laid over the game canvas (`#crt-canvas`, index.html),
 * at the size it is shown in device pixels, so the curve and the lines are drawn smooth and
 * not in the game's pixels blown up. The game canvas keeps its pixels and stays the one
 * input surface: the effect's canvas takes no input, and a pointer over it is read through
 * the same curve (`canvasPoint`), so a click lands on what the player sees.
 *
 * The curve shrinks the picture into the glass rather than magnify it: every pixel of the
 * 320x200 screen stays in sight, and only the tube's corners are black.
 */

/** How far the tube bends: the curve's strength across, and down. */
const CURVE_X = 1 / 32;
const CURVE_Y = 1 / 24;
/** The beam's width, in lines: a dark pixel's thin, a bright one's spread over its gaps. */
const BEAM_MIN = 0.24;
const BEAM_MAX = 0.36;
/** How sharp a pixel's left and right edges are: 1 is a plain blend, higher is crisper. */
const SHARPNESS = 2.5;
/** What the gaps take from the picture's brightness, given back. */
const GAIN = 1.3;
/** How much the tube's edges darken. */
const VIGNETTE = 0.12;

/** The canvas the effect is shown over, while it is on: the one whose pointer is curved. */
let curvedCanvas: HTMLCanvasElement | null = null;

/**
 * Where on the screen a point of the tube shows, both in 0..1 from the top left: the
 * shader's `warp`, for the pointer. A point of the tube's black corners is off the screen.
 */
export function crtWarp(u: number, v: number): [number, number] {
    const cx = u * 2 - 1;
    const cy = v * 2 - 1;
    return [
        (cx * (1 + cy * cy * CURVE_X)) * 0.5 + 0.5,
        (cy * (1 + cx * cx * CURVE_Y)) * 0.5 + 0.5,
    ];
}

/**
 * The canvas pixel a pointer event is over. With the effect on over this canvas, the
 * pixel the tube shows there, and a point of its black corners is the nearest edge. A
 * point off the canvas, which a captured pointer reports (`bindCanvasEvents`,
 * `src/ui/events.ts`), is its nearest edge too.
 */
export function canvasPoint(canvas: HTMLCanvasElement, e: MouseEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    let u = (e.clientX - rect.left) / rect.width;
    let v = (e.clientY - rect.top) / rect.height;
    if (canvas === curvedCanvas) [u, v] = crtWarp(u, v);
    return {
        x: Math.min(canvas.width - 1, Math.max(0, Math.floor(u * canvas.width))),
        y: Math.min(canvas.height - 1, Math.max(0, Math.floor(v * canvas.height))),
    };
}

const VERTEX_SHADER = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
    v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
    gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

// The scanlines are a beam per line, a gaussian across its centre, added up with the next
// line's in linear light; a pixel's left and right edges are a sharpened blend.
const FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D u_screen;
uniform vec2 u_screenSize;
uniform vec2 u_outputSize;
varying vec2 v_uv;

const vec2 CURVE = vec2(${CURVE_X}, ${CURVE_Y});
const float BEAM_MIN = ${BEAM_MIN};
const float BEAM_MAX = ${BEAM_MAX};
const float SHARPNESS = ${SHARPNESS};
const float GAIN = ${GAIN};
const float VIGNETTE = ${VIGNETTE};
const vec3 GAMMA = vec3(2.2);

vec2 warp(vec2 uv) {
    vec2 c = uv * 2.0 - 1.0;
    c *= vec2(1.0 + c.y * c.y * CURVE.x, 1.0 + c.x * c.x * CURVE.y);
    return c * 0.5 + 0.5;
}

vec3 line(float x, float y) {
    float left = floor(x - 0.5);
    float f = clamp((fract(x - 0.5) - 0.5) * SHARPNESS + 0.5, 0.0, 1.0);
    return pow(texture2D(u_screen, vec2(left + 0.5 + f, y) / u_screenSize).rgb, GAMMA);
}

float beam(float d, vec3 c) {
    float w = mix(BEAM_MIN, BEAM_MAX, max(max(c.r, c.g), c.b));
    return exp(-d * d / (2.0 * w * w));
}

void main() {
    vec2 p = warp(v_uv);
    vec2 pos = p * u_screenSize;
    float y0 = floor(pos.y) + 0.5;
    float dy = pos.y - y0;
    float y1 = y0 + (dy < 0.0 ? -1.0 : 1.0);
    vec3 c0 = line(pos.x, y0);
    vec3 c = c0 * beam(dy, c0);
    if (y1 > 0.0 && y1 < u_screenSize.y) {
        vec3 c1 = line(pos.x, y1);
        c += c1 * beam(1.0 - abs(dy), c1);
    }
    vec2 e = p * 2.0 - 1.0;
    c *= GAIN * (1.0 - VIGNETTE * dot(e, e));
    vec2 inside = min(p, 1.0 - p) * u_outputSize;
    float edge = clamp(min(inside.x, inside.y) + 0.5, 0.0, 1.0);
    gl_FragColor = vec4(pow(clamp(c, 0.0, 1.0), 1.0 / GAMMA) * edge, 1.0);
}`;

export interface CrtEffect {
    isAvailable: () => boolean;
    isEnabled: () => boolean;
    setEnabled: (enabled: boolean) => boolean;
}

const UNAVAILABLE: CrtEffect = { isAvailable: () => false, isEnabled: () => false, setEnabled: () => false };

interface Pipeline {
    texture: WebGLTexture;
    screenSize: WebGLUniformLocation | null;
    outputSize: WebGLUniformLocation | null;
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('cannot create a shader');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? 'shader');
    return shader;
}

/** The program, the quad it is drawn on and the screen's texture, in a fresh context. */
function buildPipeline(gl: WebGLRenderingContext): Pipeline {
    const program = gl.createProgram();
    if (!program) throw new Error('cannot create a program');
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? 'program');
    gl.useProgram(program);

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    const texture = gl.createTexture();
    if (!texture) throw new Error('cannot create a texture');
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(gl.getUniformLocation(program, 'u_screen'), 0);
    return {
        texture,
        screenSize: gl.getUniformLocation(program, 'u_screenSize'),
        outputSize: gl.getUniformLocation(program, 'u_outputSize'),
    };
}

/**
 * The effect over `canvas`, off until `setEnabled(true)`. Without WebGL it is unavailable,
 * and `setEnabled` reports it off.
 */
export function createCrtEffect(canvas: HTMLCanvasElement): CrtEffect {
    const parent = canvas.parentNode;
    if (!parent) return UNAVAILABLE;
    const tube = document.createElement('canvas');
    const gl = tube.getContext('webgl', { alpha: false, antialias: false, depth: false });
    if (!gl) return UNAVAILABLE;
    let pipeline: Pipeline;
    try {
        pipeline = buildPipeline(gl);
    } catch (e) {
        console.warn('The CRT effect cannot be built', e);
        return UNAVAILABLE;
    }
    tube.className = canvas.className;
    tube.id = 'crt-canvas';
    tube.style.display = 'none';
    parent.appendChild(tube);

    let enabled = false;
    let lost = false;
    let frame: number | null = null;

    // Every frame the page shows: the game canvas is painted by the VBL, the intro and the
    // modal screens, and whatever painted it is on the tube by the next frame.
    const draw = (): void => {
        frame = requestAnimationFrame(draw);
        if (lost) return;
        const width = Math.max(1, Math.round(tube.clientWidth * devicePixelRatio));
        const height = Math.max(1, Math.round(tube.clientHeight * devicePixelRatio));
        if (tube.width !== width || tube.height !== height) {
            tube.width = width;
            tube.height = height;
        }
        gl.viewport(0, 0, width, height);
        gl.bindTexture(gl.TEXTURE_2D, pipeline.texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
        gl.uniform2f(pipeline.screenSize, canvas.width, canvas.height);
        gl.uniform2f(pipeline.outputSize, width, height);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };

    // A lost context is waited out, the game canvas showing through; a restored one is
    // built again.
    tube.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        lost = true;
        tube.style.visibility = 'hidden';
    });
    tube.addEventListener('webglcontextrestored', () => {
        try {
            pipeline = buildPipeline(gl);
        } catch (e) {
            console.warn('The CRT effect cannot be rebuilt', e);
            return;
        }
        lost = false;
        tube.style.visibility = '';
    });

    return {
        isAvailable: () => true,
        isEnabled: () => enabled,
        setEnabled: (next: boolean) => {
            if (next === enabled) return enabled;
            enabled = next;
            tube.style.display = next ? '' : 'none';
            curvedCanvas = next ? canvas : null;
            if (next) draw();
            else if (frame !== null) {
                cancelAnimationFrame(frame);
                frame = null;
            }
            return enabled;
        },
    };
}
