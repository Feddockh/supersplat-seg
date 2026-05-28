import {
    Asset,
    BLEND_NORMAL,
    BoundingBox,
    ContainerResource,
    Entity,
    Mat4,
    Mesh as PcMesh,
    MeshInstance,
    Quat,
    SEMANTIC_COLOR,
    StandardMaterial,
    TYPE_UINT8,
    Vec3
} from 'playcanvas';

import { Element, ElementType } from './element';
import { Transform } from './transform';

const vec = new Vec3();
const tmpVec = new Vec3();

type MeshPart = {
    mesh: PcMesh;
    meshInstance: any;
    material: any;
    overlayInstance?: any;       // translucent overlay drawn on top of the base mesh
    overlayMaterial?: StandardMaterial;
    renderComponent?: any;       // render component that owns these instances
    vertexStart: number;         // offset into Mesh.vertexPositionsLocal / semanticData
    vertexCount: number;
    colorBuffer: Uint8Array;     // RGBA, length = vertexCount * 4
};

class Mesh extends Element {
    asset: Asset;
    entity: Entity;
    worldBoundStorage: BoundingBox = new BoundingBox();
    localBoundStorage: BoundingBox = new BoundingBox();

    // per-vertex annotation
    semanticData: Uint16Array = new Uint16Array(0);
    selectionState: Uint8Array = new Uint8Array(0);  // 1 = selected, 0 = not
    vertexPositionsLocal: Float32Array = new Float32Array(0);  // in mesh.entity local space
    totalVertexCount = 0;
    numSelectedVertices = 0;
    private parts: MeshPart[] = [];

    // palette state (updated by SemanticLabelManager)
    private palette: Uint8Array = new Uint8Array(64 * 4);
    private overlayEnabled = true;
    private overlayAlpha = 0.7;

    // splat-compatible API surface — kept at 0 so the transform handler always
    // routes mesh selections to EntityTransformHandler instead of the splat
    // gaussian transform handler.
    numSelected = 0;

    _name = '';
    _visible = true;

    constructor(asset: Asset, filename: string) {
        super(ElementType.mesh);

        this.asset = asset;
        this._name = filename;

        const container = asset.resource as ContainerResource;
        this.entity = container.instantiateRenderEntity();
        this.entity.name = filename;

        // the scene has no lights, so make imported materials display their
        // base color / albedo texture directly instead of going black
        this.makeMaterialsUnlit();

        this.computeLocalBound();
        this.collectVertexData();
        this.initVertexColorStreams();
    }

    private makeMaterialsUnlit() {
        const renders = this.entity.findComponents('render') as any[];
        const seen = new Set<any>();
        for (const render of renders) {
            const instances = render.meshInstances ?? [];
            for (const mi of instances) {
                const mat = mi.material;
                if (!mat || seen.has(mat)) continue;
                seen.add(mat);
                if (!(mat instanceof StandardMaterial)) continue;

                try {
                    mat.useLighting = false;
                    if (mat.diffuseMap) {
                        mat.emissiveMap = mat.diffuseMap;
                        if (mat.emissive) mat.emissive.set(1, 1, 1);
                    } else if (mat.emissive && mat.diffuse) {
                        mat.emissive.copy(mat.diffuse);
                    } else if (mat.emissive) {
                        mat.emissive.set(1, 1, 1);
                    }
                    mat.update();
                } catch (e) {
                    console.warn('Mesh: skipping material unlit conversion', e);
                }
            }
        }
    }

    // pull positions out of every primitive and store them in entity-local space.
    // each primitive becomes a MeshPart with its own vertex-color buffer.
    private collectVertexData() {
        const renders = this.entity.findComponents('render') as any[];
        const tmpPositions: number[] = [];
        let totalVerts = 0;
        const collected: { part: MeshPart, localPositions: Float32Array }[] = [];

        for (const render of renders) {
            const instances = render.meshInstances ?? [];
            for (const mi of instances) {
                const m = mi.mesh as PcMesh;
                if (!m) continue;
                tmpPositions.length = 0;
                (m as any).getPositions(tmpPositions);
                const vertexCount = (tmpPositions.length / 3) | 0;
                if (vertexCount === 0) continue;

                // mi.node.getWorldTransform() — mesh.entity hasn't been added to the
                // scene yet so its world transform is identity; node world transform
                // is therefore the chain from mi.node up to mesh.entity (local space).
                const nodeTransform: Mat4 = mi.node.getWorldTransform();
                const localPositions = new Float32Array(vertexCount * 3);
                for (let i = 0; i < vertexCount; i++) {
                    tmpVec.set(tmpPositions[i * 3], tmpPositions[i * 3 + 1], tmpPositions[i * 3 + 2]);
                    nodeTransform.transformPoint(tmpVec, tmpVec);
                    localPositions[i * 3] = tmpVec.x;
                    localPositions[i * 3 + 1] = tmpVec.y;
                    localPositions[i * 3 + 2] = tmpVec.z;
                }

                // overlay vertex stream starts fully transparent — base mesh shows through
                const colorBuffer = new Uint8Array(vertexCount * 4);

                const part: MeshPart = {
                    mesh: m,
                    meshInstance: mi,
                    material: mi.material,
                    renderComponent: render,
                    vertexStart: totalVerts,
                    vertexCount,
                    colorBuffer
                };

                this.parts.push(part);
                collected.push({ part, localPositions });
                totalVerts += vertexCount;
            }
        }

        this.totalVertexCount = totalVerts;
        this.vertexPositionsLocal = new Float32Array(totalVerts * 3);
        this.semanticData = new Uint16Array(totalVerts);
        this.selectionState = new Uint8Array(totalVerts);
        for (const { part, localPositions } of collected) {
            this.vertexPositionsLocal.set(localPositions, part.vertexStart * 3);
        }
    }

    // for each primitive: attach a per-vertex COLOR stream (used only by the
    // overlay) and build a translucent overlay meshInstance that shares the
    // same geometry. base material is unchanged — original texture renders as-is.
    // overlay instances are added to the world layer in add() and removed in
    // remove() (we can't reassign the render component's meshInstances because
    // its setter destroys the prior instances, nulling their mesh refs).
    private initVertexColorStreams() {
        for (const part of this.parts) {
            try {
                (part.mesh as any).setVertexStream(SEMANTIC_COLOR, part.colorBuffer, 4, part.vertexCount, TYPE_UINT8, true);
                part.mesh.update();
            } catch (e) {
                console.warn('Mesh: failed to set vertex color stream', e);
                continue;
            }

            const overlayMat = new StandardMaterial();
            overlayMat.useLighting = false;
            overlayMat.emissive.set(1, 1, 1);
            overlayMat.emissiveVertexColor = true;
            overlayMat.opacity = 1;
            overlayMat.opacityVertexColor = true;
            overlayMat.opacityVertexColorChannel = 'a';
            overlayMat.blendType = BLEND_NORMAL;
            overlayMat.depthWrite = false;
            const baseCull = (part.material as any)?.cull;
            if (baseCull !== undefined) (overlayMat as any).cull = baseCull;
            overlayMat.update();

            const overlay = new MeshInstance(part.mesh, overlayMat, part.meshInstance.node);
            overlay.castShadow = false;
            overlay.receiveShadow = false;

            part.overlayInstance = overlay;
            part.overlayMaterial = overlayMat;
        }
    }

    private overlayInstances(): any[] {
        return this.parts.map(p => p.overlayInstance).filter(Boolean);
    }

    // bound in the entity's local space (independent of the entity transform)
    private computeLocalBound() {
        const renders = this.entity.findComponents('render') as any[];
        let initialized = false;
        for (const render of renders) {
            const instances = render.meshInstances ?? [];
            for (const mi of instances) {
                const local = mi.mesh?.aabb;
                if (!local) continue;
                if (!initialized) {
                    this.localBoundStorage.copy(local);
                    initialized = true;
                } else {
                    this.localBoundStorage.add(local);
                }
            }
        }
        if (!initialized) {
            this.localBoundStorage.center.set(0, 0, 0);
            this.localBoundStorage.halfExtents.set(0, 0, 0);
        }
    }

    add() {
        this.scene.contentRoot.addChild(this.entity);
        const overlays = this.overlayInstances();
        if (overlays.length > 0) {
            this.scene.worldLayer.addMeshInstances(overlays);
        }
        this.scene.boundDirty = true;
        this.scene.forceRender = true;
    }

    remove() {
        const overlays = this.overlayInstances();
        if (overlays.length > 0) {
            this.scene.worldLayer.removeMeshInstances(overlays);
        }
        this.scene.contentRoot.removeChild(this.entity);
        this.scene.boundDirty = true;
        this.scene.forceRender = true;
    }

    destroy() {
        super.destroy();
        this.entity?.destroy();
        if (this.asset) {
            this.asset.registry?.remove(this.asset);
            this.asset.unload();
        }
    }

    // called after semanticData is mutated by an op — rewrite vertex colors
    updateSemanticLabels() {
        this.rebuildVertexColors();
        if (this.scene) {
            this.scene.forceRender = true;
            this.scene.events.fire('splat.semanticChanged', this);
        }
    }

    // called after selectionState is mutated by an op — refresh count + viz
    updateSelection() {
        let count = 0;
        const s = this.selectionState;
        for (let i = 0; i < s.length; i++) {
            if (s[i] !== 0) count++;
        }
        this.numSelectedVertices = count;
        this.rebuildVertexColors();
        if (this.scene) {
            this.scene.forceRender = true;
            this.scene.events.fire('splat.stateChanged', this);
        }
    }

    // called by SemanticLabelManager when palette / overlay state changes
    updateSemanticPalette(palette: Uint8Array, enabled: boolean, alpha: number) {
        this.palette.set(palette);
        this.overlayEnabled = enabled;
        this.overlayAlpha = alpha;
        this.rebuildVertexColors();
        if (this.scene) this.scene.forceRender = true;
    }

    // walk semanticData + palette and rewrite every primitive's color stream.
    // unlabeled vertices stay white (no tint); labeled vertices interpolate
    // toward the palette color by overlayAlpha (or stay white if overlay off).
    // encode each vertex as RGBA in the overlay color stream:
    //   selected   → solid yellow at SEL_ALPHA strength (wins over label)
    //   labeled    → class color at overlayAlpha strength
    //   otherwise  → fully transparent (0,0,0,0) so the base mesh shows through
    private rebuildVertexColors() {
        const overlayActive = this.overlayEnabled ? 1 : 0;
        const labelAlpha = Math.round(255 * this.overlayAlpha);
        const palette = this.palette;
        const semantic = this.semanticData;
        const selection = this.selectionState;

        const SEL_R = 255, SEL_G = 215, SEL_B = 0;
        const SEL_A = Math.round(255 * 0.85);

        for (const part of this.parts) {
            const colors = part.colorBuffer;
            const { vertexStart, vertexCount } = part;
            for (let i = 0; i < vertexCount; i++) {
                const gi = vertexStart + i;
                const off = i * 4;

                if (selection[gi] !== 0) {
                    colors[off] = SEL_R;
                    colors[off + 1] = SEL_G;
                    colors[off + 2] = SEL_B;
                    colors[off + 3] = SEL_A;
                    continue;
                }

                const label = semantic[gi];
                if (overlayActive && label !== 0) {
                    const p = label * 4;
                    if (palette[p + 3] > 0) {
                        colors[off] = palette[p];
                        colors[off + 1] = palette[p + 1];
                        colors[off + 2] = palette[p + 2];
                        colors[off + 3] = labelAlpha;
                        continue;
                    }
                }

                colors[off] = 0;
                colors[off + 1] = 0;
                colors[off + 2] = 0;
                colors[off + 3] = 0;
            }
            try {
                (part.mesh as any).setVertexStream(SEMANTIC_COLOR, colors, 4, vertexCount, TYPE_UINT8, true);
                part.mesh.update(undefined, false);
            } catch (e) {
                // ignore — happens if stream wasn't initialized
            }
        }
    }

    get localBound(): BoundingBox {
        return this.localBoundStorage;
    }

    get selectionBound(): BoundingBox {
        return this.localBoundStorage;
    }

    get worldBound(): BoundingBox | null {
        const renders = this.entity.findComponents('render') as any[];
        let initialized = false;
        for (const render of renders) {
            const instances = render.meshInstances ?? [];
            for (const mi of instances) {
                const aabb = mi.aabb;
                if (!initialized) {
                    this.worldBoundStorage.copy(aabb);
                    initialized = true;
                } else {
                    this.worldBoundStorage.add(aabb);
                }
            }
        }
        if (!initialized) {
            this.worldBoundStorage.center.copy(this.entity.getPosition());
            this.worldBoundStorage.halfExtents.set(0, 0, 0);
        }
        return this.worldBoundStorage;
    }

    get worldTransform() {
        return this.entity.getWorldTransform();
    }

    set name(value: string) {
        if (value !== this._name) {
            this._name = value;
            this.scene?.events.fire('splat.name', this);
        }
    }

    get name() {
        return this._name;
    }

    get visible() {
        return this._visible;
    }

    set visible(value: boolean) {
        if (value !== this._visible) {
            this._visible = value;
            this.entity.enabled = value;
            // overlay instances live on the world layer directly, not under
            // the render component, so toggle their visible flag too
            for (const overlay of this.overlayInstances()) {
                overlay.visible = value;
            }
            this.scene?.events.fire('splat.visibility', this);
            if (this.scene) this.scene.forceRender = true;
        }
    }

    move(position?: Vec3, rotation?: Quat, scale?: Vec3) {
        if (position) this.entity.setLocalPosition(position);
        if (rotation) this.entity.setLocalRotation(rotation);
        if (scale) this.entity.setLocalScale(scale);
        if (this.scene) {
            this.scene.boundDirty = true;
            this.scene.forceRender = true;
        }
    }

    getPivot(mode: 'center' | 'boundCenter', _selection: boolean, result: Transform) {
        const { entity } = this;
        switch (mode) {
            case 'center':
                result.set(entity.getLocalPosition(), entity.getLocalRotation(), entity.getLocalScale());
                break;
            case 'boundCenter': {
                entity.getLocalTransform().transformPoint(this.localBoundStorage.center, vec);
                result.set(vec, entity.getLocalRotation(), entity.getLocalScale());
                break;
            }
        }
    }
}

export { Mesh };
