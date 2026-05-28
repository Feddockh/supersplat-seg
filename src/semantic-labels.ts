import { Vec3 } from 'playcanvas';

import { MeshSelectOp, SelectOp, SemanticLabelOp } from './edit-ops';
import { ElementType } from './element';
import { Events } from './events';
import { Mesh } from './mesh';
import { Scene } from './scene';
import { Splat } from './splat';
import { State } from './splat-state';

type SemanticClass = {
    id: number;
    name: string;
    color: [number, number, number];
    visible: boolean;
};

type SemanticCentroid = {
    splat: string;
    classId: number;
    className: string;
    color: [number, number, number];
    clusterIndex: number;
    count: number;
    centroid: [number, number, number];
};

type SemanticCentroidExport = {
    version: 1;
    segments: SemanticCentroid[];
};

const MAX_CLASSES = 63;
const tmp = new Vec3();

// DBSCAN clustering with voxel-grid acceleration for O(n) neighbor lookups.
// Uses a cell size equal to epsilon so only 27 adjacent cells need checking.
// With minPts=1 every point is a core point — no noise, just connected components
// linked by true Euclidean distance. Returns a cluster id per input point (0-based).
const dbscanCluster = (pts: { x: number; y: number; z: number }[], epsilon: number): number[] => {
    if (pts.length === 0) return [];

    const eps2 = epsilon * epsilon;
    const grid = new Map<string, number[]>();
    const voxels: [number, number, number][] = new Array(pts.length);

    for (let i = 0; i < pts.length; i++) {
        const vx = Math.floor(pts[i].x / epsilon);
        const vy = Math.floor(pts[i].y / epsilon);
        const vz = Math.floor(pts[i].z / epsilon);
        voxels[i] = [vx, vy, vz];
        const key = `${vx},${vy},${vz}`;
        const cell = grid.get(key);
        if (cell) cell.push(i); else grid.set(key, [i]);
    }

    const epsilonNeighbors = (i: number): number[] => {
        const [vx, vy, vz] = voxels[i];
        const result: number[] = [];
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dz = -1; dz <= 1; dz++) {
                    const cell = grid.get(`${vx + dx},${vy + dy},${vz + dz}`);
                    if (!cell) continue;
                    for (const j of cell) {
                        if (j === i) continue;
                        const ex = pts[i].x - pts[j].x;
                        const ey = pts[i].y - pts[j].y;
                        const ez = pts[i].z - pts[j].z;
                        if (ex * ex + ey * ey + ez * ez <= eps2) result.push(j);
                    }
                }
            }
        }
        return result;
    };

    const clusterOf = new Int32Array(pts.length).fill(-1);
    let nextCluster = 0;

    for (let i = 0; i < pts.length; i++) {
        if (clusterOf[i] !== -1) continue;
        clusterOf[i] = nextCluster;
        const queue = epsilonNeighbors(i).filter(j => clusterOf[j] === -1);
        for (const j of queue) clusterOf[j] = nextCluster;
        let qi = 0;
        while (qi < queue.length) {
            const j = queue[qi++];
            for (const k of epsilonNeighbors(j)) {
                if (clusterOf[k] === -1) {
                    clusterOf[k] = nextCluster;
                    queue.push(k);
                }
            }
        }
        nextCluster++;
    }

    return Array.from(clusterOf);
};

const colorForId = (id: number): [number, number, number] => {
    const hue = (id * 0.61803398875) % 1;
    const f = (n: number) => {
        const k = (n + hue * 6) % 6;
        return 0.28 + 0.72 * (1 - Math.max(0, Math.min(k, 4 - k, 1)));
    };
    return [f(5), f(3), f(1)];
};

class SemanticLabelManager {
    events: Events;
    scene: Scene;
    classes = new Map<number, SemanticClass>();
    activeClassId = 1;
    overlayEnabled = true;
    overlayAlpha = 0.7;
    clusterEpsilon = 0.05;
    private nextClassId = 1;

    constructor(events: Events, scene: Scene) {
        this.events = events;
        this.scene = scene;

        this.addClass('Class 1', [1, 0.35, 0.05]);

        events.on('scene.elementAdded', (element) => {
            if (element.type === ElementType.splat) {
                this.updateSplatPalette(element as Splat);
            } else if (element.type === ElementType.mesh) {
                this.updateMeshPalette(element as Mesh);
            }
        });

        events.on('edit.apply', () => {
            this.changed();
        });

        // Reset to defaults when the scene is cleared (new document / load)
        events.on('scene.clear', () => {
            this.classes.clear();
            this.nextClassId = 1;
            this.addClass('Class 1', [1, 0.35, 0.05]);
            this.activeClassId = 1;
            this.overlayEnabled = true;
            this.overlayAlpha = 0.7;
            events.fire('semantic.changed');
        });

        events.function('docSerialize.semanticLabels', () => {
            return {
                classes: [...this.classes.values()],
                activeClassId: this.activeClassId,
                overlayEnabled: this.overlayEnabled,
                overlayAlpha: this.overlayAlpha,
                nextClassId: this.nextClassId
            };
        });

        events.function('docDeserialize.semanticLabels', (data?: {
            classes: SemanticClass[];
            activeClassId: number;
            overlayEnabled: boolean;
            overlayAlpha: number;
            nextClassId: number;
        }) => {
            if (!data?.classes?.length) return;
            this.classes.clear();
            for (const cls of data.classes) {
                this.classes.set(cls.id, cls);
            }
            this.activeClassId = data.activeClassId ?? 1;
            this.overlayEnabled = data.overlayEnabled ?? true;
            this.overlayAlpha = data.overlayAlpha ?? 0.7;
            this.nextClassId = data.nextClassId ?? (Math.max(0, ...this.classes.keys()) + 1);
            this.changed();
        });
    }

    get splats() {
        return this.scene.getElementsByType(ElementType.splat) as Splat[];
    }

    get meshes() {
        return this.scene.getElementsByType(ElementType.mesh) as Mesh[];
    }

    private buildPalette() {
        const palette = new Uint8Array(64 * 4);
        for (const cls of this.classes.values()) {
            if (cls.id < 1 || cls.id > MAX_CLASSES) continue;
            const offset = cls.id * 4;
            palette[offset] = Math.round(cls.color[0] * 255);
            palette[offset + 1] = Math.round(cls.color[1] * 255);
            palette[offset + 2] = Math.round(cls.color[2] * 255);
            palette[offset + 3] = cls.visible ? 255 : 0;
        }
        return palette;
    }

    private changed() {
        const palette = this.buildPalette();
        for (const splat of this.splats) {
            splat.updateSemanticPalette(palette, this.overlayEnabled, this.overlayAlpha);
        }
        for (const mesh of this.meshes) {
            mesh.updateSemanticPalette(palette, this.overlayEnabled, this.overlayAlpha);
        }
        this.events.fire('semantic.changed');
        this.scene.forceRender = true;
    }

    private updateSplatPalette(splat: Splat) {
        splat.updateSemanticPalette(this.buildPalette(), this.overlayEnabled, this.overlayAlpha);
    }

    private updateMeshPalette(mesh: Mesh) {
        mesh.updateSemanticPalette(this.buildPalette(), this.overlayEnabled, this.overlayAlpha);
    }

    addClass(name = `Class ${this.nextClassId}`, color?: [number, number, number]) {
        if (this.classes.size >= MAX_CLASSES) {
            return null;
        }

        while (this.classes.has(this.nextClassId) && this.nextClassId <= MAX_CLASSES) {
            this.nextClassId++;
        }

        const id = this.nextClassId;
        const cls: SemanticClass = {
            id,
            name,
            color: color ?? colorForId(id),
            visible: true
        };

        this.classes.set(id, cls);
        this.activeClassId = id;
        this.nextClassId++;
        this.changed();
        return cls;
    }

    updateClass(id: number, updates: Partial<Omit<SemanticClass, 'id'>>) {
        const cls = this.classes.get(id);
        if (!cls) return;
        Object.assign(cls, updates);
        this.changed();
    }

    deleteClass(id: number) {
        if (!this.classes.has(id)) return;
        this.classes.delete(id);

        const clearOn = (target: { semanticData: Uint16Array, updateSemanticLabels(): void }) => {
            const semantic = target.semanticData;
            const indices: number[] = [];
            const oldLabels: number[] = [];
            for (let i = 0; i < semantic.length; i++) {
                if (semantic[i] === id) {
                    indices.push(i);
                    oldLabels.push(id);
                }
            }
            if (indices.length > 0) {
                this.events.fire('edit.add', new SemanticLabelOp({
                    splat: target,
                    indices: Uint32Array.from(indices),
                    oldLabels: Uint16Array.from(oldLabels),
                    newLabel: 0
                }));
            }
        };

        for (const splat of this.splats) clearOn(splat);
        for (const mesh of this.meshes) clearOn(mesh);

        if (this.activeClassId === id) {
            this.activeClassId = this.classes.keys().next().value ?? 0;
        }
        this.changed();
    }

    setActiveClass(id: number) {
        if (this.classes.has(id)) {
            this.activeClassId = id;
            this.events.fire('semantic.changed');
        }
    }

    setOverlay(enabled: boolean) {
        this.overlayEnabled = enabled;
        this.changed();
    }

    setOverlayAlpha(alpha: number) {
        this.overlayAlpha = Math.max(0, Math.min(1, alpha));
        this.changed();
    }

    assignSelection(classId = this.activeClassId) {
        const cls = this.classes.get(classId);
        if (!cls) return;

        for (const splat of this.splats) {
            if (this.events.invoke('selection') !== splat) continue;

            const state = splat.splatData.getProp('state') as Uint8Array;
            const semantic = splat.semanticData;
            const indices: number[] = [];
            const oldLabels: number[] = [];

            for (let i = 0; i < state.length; i++) {
                if (state[i] === State.selected && semantic[i] !== classId) {
                    indices.push(i);
                    oldLabels.push(semantic[i]);
                }
            }

            if (indices.length > 0) {
                this.events.fire('edit.add', new SemanticLabelOp({
                    splat,
                    indices: Uint32Array.from(indices),
                    oldLabels: Uint16Array.from(oldLabels),
                    newLabel: classId
                }));
            }
        }

        for (const mesh of this.meshes) {
            if (this.events.invoke('selection') !== mesh) continue;
            this.assignMeshSelection(mesh, classId);
        }
    }

    clearSelection() {
        for (const splat of this.splats) {
            if (this.events.invoke('selection') !== splat) continue;

            const state = splat.splatData.getProp('state') as Uint8Array;
            const semantic = splat.semanticData;
            const indices: number[] = [];
            const oldLabels: number[] = [];

            for (let i = 0; i < state.length; i++) {
                if (state[i] === State.selected && semantic[i] !== 0) {
                    indices.push(i);
                    oldLabels.push(semantic[i]);
                }
            }

            if (indices.length > 0) {
                this.events.fire('edit.add', new SemanticLabelOp({
                    splat,
                    indices: Uint32Array.from(indices),
                    oldLabels: Uint16Array.from(oldLabels),
                    newLabel: 0
                }));
            }
        }

        for (const mesh of this.meshes) {
            if (this.events.invoke('selection') !== mesh) continue;
            this.assignMeshSelection(mesh, 0);
        }
    }

    // walk the mesh's per-vertex selectionState and write `newLabel` into
    // semanticData wherever a vertex is selected (and not already at that label).
    private assignMeshSelection(mesh: Mesh, newLabel: number) {
        const selection = mesh.selectionState;
        const semantic = mesh.semanticData;
        const indices: number[] = [];
        const oldLabels: number[] = [];

        for (let i = 0; i < selection.length; i++) {
            if (selection[i] !== 0 && semantic[i] !== newLabel) {
                indices.push(i);
                oldLabels.push(semantic[i]);
            }
        }

        if (indices.length > 0) {
            this.events.fire('edit.add', new SemanticLabelOp({
                splat: mesh,
                indices: Uint32Array.from(indices),
                oldLabels: Uint16Array.from(oldLabels),
                newLabel
            }));
        }
    }

    selectClass(id: number) {
        for (const splat of this.splats) {
            const semantic = splat.semanticData;
            const mask = new Uint8Array(semantic.length);
            for (let i = 0; i < semantic.length; i++) {
                if (semantic[i] === id) {
                    mask[i] = 255;
                }
            }
            this.events.fire('edit.add', new SelectOp(splat, 'set', mask));
        }

        for (const mesh of this.meshes) {
            const semantic = mesh.semanticData;
            const mask = new Uint8Array(semantic.length);
            for (let i = 0; i < semantic.length; i++) {
                if (semantic[i] === id) mask[i] = 255;
            }
            this.events.fire('edit.add', new MeshSelectOp(mesh, 'set', mask));
        }
    }

    exportCentroids(): SemanticCentroidExport {
        const epsilon = this.clusterEpsilon;
        const segments: SemanticCentroid[] = [];

        for (const splat of this.splats) {
            const semantic = splat.semanticData;
            const state = splat.splatData.getProp('state') as Uint8Array;
            const x = splat.splatData.getProp('x') as Float32Array;
            const y = splat.splatData.getProp('y') as Float32Array;
            const z = splat.splatData.getProp('z') as Float32Array;

            for (const cls of this.classes.values()) {
                // Collect world-space positions for this class
                const pts: Vec3[] = [];
                for (let i = 0; i < semantic.length; i++) {
                    if (semantic[i] === cls.id && (state[i] & State.deleted) === 0) {
                        tmp.set(x[i], y[i], z[i]);
                        splat.worldTransform.transformPoint(tmp, tmp);
                        pts.push(tmp.clone());
                    }
                }

                if (pts.length === 0) continue;

                // Cluster with DBSCAN using true Euclidean epsilon-neighborhoods
                const clusterIds = dbscanCluster(pts, epsilon);
                const numClusters = Math.max(...clusterIds) + 1;

                for (let c = 0; c < numClusters; c++) {
                    const sum = new Vec3();
                    let count = 0;
                    for (let i = 0; i < pts.length; i++) {
                        if (clusterIds[i] === c) {
                            sum.add(pts[i]);
                            count++;
                        }
                    }
                    sum.mulScalar(1 / count);
                    segments.push({
                        splat: splat.filename,
                        classId: cls.id,
                        className: cls.name,
                        color: cls.color,
                        clusterIndex: c,
                        count,
                        centroid: [sum.x, sum.y, sum.z]
                    });
                }
            }
        }

        for (const mesh of this.meshes) {
            const semantic = mesh.semanticData;
            const localPos = mesh.vertexPositionsLocal;
            const worldXf = mesh.worldTransform;

            for (const cls of this.classes.values()) {
                const pts: Vec3[] = [];
                for (let i = 0; i < semantic.length; i++) {
                    if (semantic[i] === cls.id) {
                        tmp.set(localPos[i * 3], localPos[i * 3 + 1], localPos[i * 3 + 2]);
                        worldXf.transformPoint(tmp, tmp);
                        pts.push(tmp.clone());
                    }
                }

                if (pts.length === 0) continue;

                const clusterIds = dbscanCluster(pts, epsilon);
                const numClusters = Math.max(...clusterIds) + 1;

                for (let c = 0; c < numClusters; c++) {
                    const sum = new Vec3();
                    let count = 0;
                    for (let i = 0; i < pts.length; i++) {
                        if (clusterIds[i] === c) {
                            sum.add(pts[i]);
                            count++;
                        }
                    }
                    sum.mulScalar(1 / count);
                    segments.push({
                        splat: mesh.name,
                        classId: cls.id,
                        className: cls.name,
                        color: cls.color,
                        clusterIndex: c,
                        count,
                        centroid: [sum.x, sum.y, sum.z]
                    });
                }
            }
        }

        return { version: 1, segments };
    }
}

export {
    SemanticClass,
    SemanticCentroid,
    SemanticCentroidExport,
    SemanticLabelManager
};
