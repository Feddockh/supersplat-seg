import { Vec3 } from 'playcanvas';

import { SelectOp, SemanticLabelOp } from './edit-ops';
import { ElementType } from './element';
import { Events } from './events';
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
    count: number;
    centroid: [number, number, number];
};

type SemanticCentroidExport = {
    version: 1;
    segments: SemanticCentroid[];
};

const MAX_CLASSES = 63;
const tmp = new Vec3();

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
    private nextClassId = 1;

    constructor(events: Events, scene: Scene) {
        this.events = events;
        this.scene = scene;

        this.addClass('Class 1', [1, 0.35, 0.05]);

        events.on('scene.elementAdded', (element) => {
            if (element.type === ElementType.splat) {
                this.updateSplatPalette(element as Splat);
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

    private changed() {
        for (const splat of this.splats) {
            this.updateSplatPalette(splat);
        }
        this.events.fire('semantic.changed');
        this.scene.forceRender = true;
    }

    private updateSplatPalette(splat: Splat) {
        const palette = new Uint8Array(64 * 4);
        for (const cls of this.classes.values()) {
            if (cls.id < 1 || cls.id > MAX_CLASSES) continue;
            const offset = cls.id * 4;
            palette[offset] = Math.round(cls.color[0] * 255);
            palette[offset + 1] = Math.round(cls.color[1] * 255);
            palette[offset + 2] = Math.round(cls.color[2] * 255);
            palette[offset + 3] = cls.visible ? 255 : 0;
        }
        splat.updateSemanticPalette(palette, this.overlayEnabled, this.overlayAlpha);
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

        for (const splat of this.splats) {
            const semantic = splat.semanticData;
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
                    splat,
                    indices: Uint32Array.from(indices),
                    oldLabels: Uint16Array.from(oldLabels),
                    newLabel: 0
                }));
            }
        }

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
    }

    exportCentroids(): SemanticCentroidExport {
        const segments: SemanticCentroid[] = [];

        for (const splat of this.splats) {
            const semantic = splat.semanticData;
            const state = splat.splatData.getProp('state') as Uint8Array;
            const x = splat.splatData.getProp('x') as Float32Array;
            const y = splat.splatData.getProp('y') as Float32Array;
            const z = splat.splatData.getProp('z') as Float32Array;

            for (const cls of this.classes.values()) {
                let count = 0;
                const sum = new Vec3();
                for (let i = 0; i < semantic.length; i++) {
                    if (semantic[i] === cls.id && (state[i] & State.deleted) === 0) {
                        tmp.set(x[i], y[i], z[i]);
                        splat.worldTransform.transformPoint(tmp, tmp);
                        sum.add(tmp);
                        count++;
                    }
                }

                if (count > 0) {
                    sum.mulScalar(1 / count);
                    segments.push({
                        splat: splat.filename,
                        classId: cls.id,
                        className: cls.name,
                        color: cls.color,
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
