import {
    BLENDEQUATION_ADD,
    BLENDMODE_ONE,
    BLENDMODE_ZERO,
    BLENDMODE_ONE_MINUS_SRC_ALPHA,
    BlendState,
    Color,
    GraphicsDevice,
    RenderPassPicker,
    RenderTarget
} from 'playcanvas';

import { ElementType } from './element';
import { Scene } from './scene';
import { Splat } from './splat';

const idClearColor = new Color(1, 1, 1, 1);
const depthClearColor = new Color(0, 0, 0, 1);

// Shared buffer for half-to-float conversion
const float32 = new Float32Array(1);
const uint32 = new Uint32Array(float32.buffer);

// Convert 16-bit half-float to 32-bit float using bit manipulation
const half2Float = (h: number): number => {
    const sign = (h & 0x8000) << 16;           // Move sign to bit 31
    const exponent = (h & 0x7C00) >> 10;       // Extract 5-bit exponent
    const mantissa = h & 0x03FF;               // Extract 10-bit mantissa

    if (exponent === 0) {
        if (mantissa === 0) {
            // Zero
            uint32[0] = sign;
        } else {
            // Denormalized: convert to normalized float32
            let e = -1;
            let m = mantissa;
            do {
                e++;
                m <<= 1;
            } while ((m & 0x0400) === 0);
            uint32[0] = sign | ((127 - 15 - e) << 23) | ((m & 0x03FF) << 13);
        }
    } else if (exponent === 31) {
        // Infinity or NaN
        uint32[0] = sign | 0x7F800000 | (mantissa << 13);
    } else {
        // Normalized: adjust exponent bias from 15 to 127
        uint32[0] = sign | ((exponent + 127 - 15) << 23) | (mantissa << 13);
    }

    return float32[0];
};

class Picker {
    private device: GraphicsDevice;
    private scene: Scene;

    // Render targets (provided by camera)
    private depthRenderTarget: RenderTarget | null = null;
    private idRenderTarget: RenderTarget | null = null;

    // Render pass (shared for depth and ID picking)
    private renderPass: RenderPassPicker;

    // Blend state for depth accumulation
    private depthBlendState: BlendState;

    constructor(scene: Scene) {
        this.scene = scene;
        this.device = scene.graphicsDevice;

        // Create shared render pass for picking
        this.renderPass = new RenderPassPicker(this.device, this.scene.app.renderer);

        // Blend state for depth accumulation:
        // RGB: additive depth accumulation (ONE, ONE_MINUS_SRC_ALPHA)
        // Alpha: multiplicative transmittance (ZERO, ONE_MINUS_SRC_ALPHA) -> T = T * (1 - alpha)
        this.depthBlendState = new BlendState(
            true,
            BLENDEQUATION_ADD, BLENDMODE_ONE, BLENDMODE_ONE_MINUS_SRC_ALPHA,           // RGB blend
            BLENDEQUATION_ADD, BLENDMODE_ZERO, BLENDMODE_ONE_MINUS_SRC_ALPHA           // Alpha blend (transmittance)
        );
    }

    // Set render targets from camera
    setRenderTargets(depthRT: RenderTarget, idRT: RenderTarget) {
        this.depthRenderTarget = depthRT;
        this.idRenderTarget = idRT;
    }

    // Prepare for ID picking by rendering the specified splat
    prepareId(splat: Splat, mode: 'add' | 'remove' | 'set') {
        if (!this.idRenderTarget) {
            return;
        }

        const { splatLayer } = this.scene;

        // Hide non-selected elements, saving previous enabled state so hidden splats stay hidden
        const splats = this.scene.getElementsByType(ElementType.splat) as Splat[];
        const prevEnabled = splats.map(s => s.entity.enabled);
        splats.forEach((s) => {
            s.entity.enabled = s === splat;
        });

        // Set picker uniforms
        this.device.scope.resolve('pickOp').setValue(['add', 'remove', 'set'].indexOf(mode));
        this.device.scope.resolve('pickMode').setValue(0);

        // Render ID picking pass
        const emptyMap = new Map();
        this.renderPass.blendState = BlendState.NOBLEND;
        this.renderPass.init(this.idRenderTarget);
        this.renderPass.setClearColor(idClearColor);
        this.renderPass.update(this.scene.camera.camera, this.scene.app.scene, [splatLayer], emptyMap, false);
        this.renderPass.render();

        // Restore original enabled state for each splat
        splats.forEach((s, i) => {
            s.entity.enabled = prevEnabled[i];
        });
    }

    // Read single splat ID at normalized screen position (after prepareId)
    async readId(x: number, y: number): Promise<number> {
        if (!this.idRenderTarget) {
            return -1;
        }
        // For single pixel read, use a minimal normalized size
        const rt = this.idRenderTarget;
        const ids = await this.readIds(x, y, 1 / rt.width, 1 / rt.height);
        return ids[0];
    }

    // Read rectangle of splat IDs using normalized coordinates (0-1 range) (after prepareId)
    async readIds(x: number, y: number, width: number, height: number): Promise<number[]> {
        if (!this.idRenderTarget) {
            return [];
        }

        const rt = this.idRenderTarget;
        const colorBuffer = rt.colorBuffer;

        // Convert normalized coordinates to render target pixels
        const px = Math.floor(x * rt.width);
        const py = Math.floor(y * rt.height);
        const pw = Math.max(1, Math.ceil((x + width) * rt.width) - px);
        const ph = Math.max(1, Math.ceil((y + height) * rt.height) - py);

        // Flip Y for texture read on WebGL (texture origin is bottom-left)
        const texY = this.device.isWebGL2 ? rt.height - py - ph : py;

        // Read pixels using texture.read() API
        const pixels = await colorBuffer.read(px, texY, pw, ph, {
            renderTarget: rt,
            immediate: false
        });

        const result: number[] = [];
        for (let i = 0; i < pw * ph; i++) {
            // Use >>> 0 to convert signed 32-bit to unsigned (so 0xffffffff instead of -1)
            result.push(
                (pixels[i * 4] |
                (pixels[i * 4 + 1] << 8) |
                (pixels[i * 4 + 2] << 16) |
                (pixels[i * 4 + 3] << 24)) >>> 0
            );
        }

        return result;
    }

    // Prepare for depth picking by rendering the specified splat
    prepareDepth(splat: Splat) {
        if (!this.depthRenderTarget) {
            return;
        }

        const { scene } = this;
        const { app, camera, splatLayer } = scene;
        const emptyMap = new Map();

        // Hide non-selected elements, saving previous enabled state so hidden splats stay hidden
        const splats = scene.getElementsByType(ElementType.splat) as Splat[];
        const prevEnabled = splats.map(s => s.entity.enabled);
        splats.forEach((s) => {
            s.entity.enabled = s === splat;
        });

        // Set depth estimation mode uniform
        this.device.scope.resolve('pickOp').setValue(2); // 'set' mode - don't skip any visible splats
        this.device.scope.resolve('pickMode').setValue(1);

        // Render scene with depth pass
        this.renderPass.blendState = this.depthBlendState;
        this.renderPass.init(this.depthRenderTarget);
        this.renderPass.setClearColor(depthClearColor);
        this.renderPass.update(camera.camera, app.scene, [splatLayer], emptyMap, false);
        this.renderPass.render();

        // Restore original enabled state for each splat
        splats.forEach((s, i) => {
            s.entity.enabled = prevEnabled[i];
        });
    }

    // Read normalized depth (0-1) at normalized screen position (0-1 range) (after prepareDepth)
    // Samples a small neighborhood around the target pixel so that clicks landing
    // in low-opacity gaps between splats fall back to the nearest valid pixel.
    async readDepth(x: number, y: number, radius = 2): Promise<number | null> {
        if (!this.depthRenderTarget) {
            return null;
        }

        const rt = this.depthRenderTarget;
        const colorBuffer = rt.colorBuffer;

        // Convert normalized coordinates to render target pixels
        const px = Math.floor(x * rt.width);
        const py = Math.floor(y * rt.height);

        // Read a (2*radius+1) square block centred on the target pixel, clamped to
        // the render target bounds.
        const x0 = Math.max(0, px - radius);
        const y0 = Math.max(0, py - radius);
        const x1 = Math.min(rt.width - 1, px + radius);
        const y1 = Math.min(rt.height - 1, py + radius);
        const bw = x1 - x0 + 1;
        const bh = y1 - y0 + 1;

        // Flip Y for texture read on WebGL (texture origin is bottom-left)
        const texY = this.device.isWebGL2 ? rt.height - y1 - 1 : y0;

        // Read the block using Texture.read() which handles RGBA16F format
        const pixels = await colorBuffer.read(x0, texY, bw, bh, { renderTarget: rt });

        // Walk the block and keep the valid sample closest to the target pixel.
        // R channel: accumulated depth * alpha, A channel: transmittance (1 - alpha)
        let bestDepth: number | null = null;
        let bestDist = Infinity;
        for (let j = 0; j < bh; j++) {
            for (let i = 0; i < bw; i++) {
                const idx = (j * bw + i) * 4;
                const transmittance = half2Float(pixels[idx + 3]);
                const alpha = 1 - transmittance;

                // Skip near-transparent pixels (nothing visible here)
                if (alpha < 1e-6) {
                    continue;
                }

                // Map back to render-target pixel coords to measure distance.
                // Account for the Y flip when computing the source row.
                const srcX = x0 + i;
                const srcY = this.device.isWebGL2 ? y1 - j : y0 + j;
                const dist = (srcX - px) * (srcX - px) + (srcY - py) * (srcY - py);
                if (dist < bestDist) {
                    bestDist = dist;
                    bestDepth = half2Float(pixels[idx]) / alpha;
                }
            }
        }

        // Return normalized depth (0-1 range), or null if nothing was visible
        return bestDepth;
    }

    // Clean up resources
    destroy() {
        this.renderPass?.destroy();
    }
}

export { Picker };
