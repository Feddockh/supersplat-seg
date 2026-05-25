import { Container } from '@playcanvas/pcui';
import {
    Color,
    Entity,
    Mat4,
    StandardMaterial,
    TranslateGizmo,
    Vec3
} from 'playcanvas';

import { AnnotationManager, AnnotationClass, AnnotationPointData } from '../annotation-manager';
import { Events } from '../events';
import { Scene } from '../scene';

const mat = new Mat4();
const localPos = new Vec3();
const screenPoint = new Vec3();
const worldPos = new Vec3();

class AnnotationTransformHandler {
    activate() {}
    deactivate() {}
}

interface AnnotationEntity {
    id: string;
    sphere: Entity;
    material: StandardMaterial;
    gizmoPivot: Entity;
}

const classColor = (cls: AnnotationClass | undefined): [number, number, number] => {
    return cls ? cls.color : [1, 1, 1];
};

class AnnotationTool {
    activate: () => void;
    deactivate: () => void;

    constructor(
        events: Events,
        scene: Scene,
        manager: AnnotationManager,
        canvasContainer: Container
    ) {
        const gizmo = new TranslateGizmo(scene.camera.camera, scene.gizmoLayer);
        const transformHandler = new AnnotationTransformHandler();

        let active = false;

        const annotationEntities = new Map<string, AnnotationEntity>();

        const getRadius = () => Math.max(0.01, scene.camera.sceneRadius * 0.02);

        const applyColor = (ae: AnnotationEntity, point: AnnotationPointData) => {
            const cls = point.classId ? manager.classes.get(point.classId) : undefined;
            const [r, g, b] = classColor(cls);
            ae.material.emissive = new Color(r, g, b);
            ae.material.emissiveIntensity = 1;
            ae.material.update();
        };

        const createAnnotationEntity = (point: AnnotationPointData): AnnotationEntity => {
            // Sphere entity — child of contentRoot so Z-up rotation is applied automatically
            const sphere = new Entity(`annotation_${point.id}`);
            sphere.addComponent('render', { type: 'sphere' });
            (sphere.render as any).layers = [scene.worldLayer.id];

            const material = new StandardMaterial();
            material.useLighting = false;
            material.update();

            sphere.render.meshInstances[0].material = material;

            const radius = getRadius();
            sphere.setLocalScale(radius, radius, radius);
            sphere.setLocalPosition(point.position[0], point.position[1], point.position[2]);

            scene.contentRoot.addChild(sphere);

            // Gizmo pivot lives in world root so gizmo coordinates are correct
            const gizmoPivot = new Entity(`annotationGizmo_${point.id}`);
            scene.app.root.addChild(gizmoPivot);

            const ae: AnnotationEntity = { id: point.id, sphere, material, gizmoPivot };
            applyColor(ae, point);
            return ae;
        };

        const attachGizmo = (point: AnnotationPointData | null) => {
            gizmo.detach();
            if (!point) return;
            const ae = annotationEntities.get(point.id);
            if (!ae) return;
            // Place gizmo pivot at the sphere's current world position
            ae.gizmoPivot.setPosition(ae.sphere.getPosition());
            gizmo.attach([ae.gizmoPivot]);
        };

        // Always-on listeners so import works even when the tool is not active
        events.on('annotation.pointAdded', (point: AnnotationPointData) => {
            const ae = createAnnotationEntity(point);
            annotationEntities.set(point.id, ae);
            scene.forceRender = true;
        });

        events.on('annotation.pointDeleted', (pointId: string) => {
            const ae = annotationEntities.get(pointId);
            if (ae) {
                if (ae === annotationEntities.get(manager.selectedPointId ?? '')) {
                    gizmo.detach();
                }
                scene.contentRoot.removeChild(ae.sphere);
                scene.app.root.removeChild(ae.gizmoPivot);
                ae.sphere.destroy();
                ae.gizmoPivot.destroy();
                annotationEntities.delete(pointId);
            }
            scene.forceRender = true;
        });

        events.on('annotation.pointUpdated', (point: AnnotationPointData) => {
            const ae = annotationEntities.get(point.id);
            if (!ae) return;
            ae.sphere.setLocalPosition(point.position[0], point.position[1], point.position[2]);
            applyColor(ae, point);
            // reposition gizmo if this point is selected
            if (manager.selectedPointId === point.id) {
                ae.gizmoPivot.setPosition(ae.sphere.getPosition());
            }
            scene.forceRender = true;
        });

        events.on('annotation.classUpdated', (cls: AnnotationClass) => {
            for (const [, point] of manager.points) {
                if (point.classId === cls.id) {
                    const ae = annotationEntities.get(point.id);
                    if (ae) applyColor(ae, point);
                }
            }
            scene.forceRender = true;
        });

        events.on('annotation.selectionChanged', (point: AnnotationPointData | null) => {
            attachGizmo(point);
            scene.forceRender = true;
        });

        // Swap Y/Z axis colors when Z-up is active (world-Y = data-Z = up should be blue)
        const defaultYColor = gizmo.yAxisColor.clone();
        const defaultZColor = gizmo.zAxisColor.clone();
        const setGizmoZUp = (zUp: boolean) => {
            gizmo.yAxisColor = zUp ? defaultZColor.clone() : defaultYColor.clone();
            gizmo.zAxisColor = zUp ? defaultYColor.clone() : defaultZColor.clone();
        };
        events.on('view.zUp', setGizmoZUp);
        setGizmoZUp(events.invoke('view.zUp') ?? false);

        // Update gizmo size when canvas changes
        const updateGizmoSize = () => {
            const { camera, canvas } = scene;
            if (camera.ortho) {
                gizmo.size = 1125 / canvas.clientHeight;
            } else {
                gizmo.size = 1200 / Math.max(canvas.clientWidth, canvas.clientHeight);
            }
        };
        updateGizmoSize();
        events.on('camera.resize', updateGizmoSize);
        events.on('camera.ortho', updateGizmoSize);

        gizmo.on('render:update', () => {
            scene.forceRender = true;
        });

        gizmo.on('transform:move', () => {
            const point = manager.selectedPoint;
            if (!point) return;
            const ae = annotationEntities.get(point.id);
            if (!ae) return;

            // Get gizmo pivot world position and convert to contentRoot-local
            const wp = ae.gizmoPivot.getPosition();
            mat.copy(scene.contentRoot.getWorldTransform());
            mat.invert();
            mat.transformPoint(wp, localPos);

            ae.sphere.setLocalPosition(localPos.x, localPos.y, localPos.z);
            manager.updatePointPosition(point.id, [localPos.x, localPos.y, localPos.z]);
            scene.forceRender = true;
        });

        const isPrimary = (e: PointerEvent) => {
            return e.pointerType === 'mouse' ? e.button === 0 : e.isPrimary;
        };

        let clicked = false;

        const pointerdown = (e: PointerEvent) => {
            if (!clicked && isPrimary(e)) {
                clicked = true;
            }
        };

        const pointermove = () => {
            clicked = false;
        };

        const pointerup = async (e: PointerEvent) => {
            if (!clicked || !isPrimary(e)) return;
            clicked = false;

            const w = canvasContainer.dom.clientWidth;
            const h = canvasContainer.dom.clientHeight;

            // Check if click is near any existing annotation point (8px tolerance)
            let hitId: string | null = null;
            for (const [id, ae] of annotationEntities) {
                scene.camera.worldToScreen(ae.sphere.getPosition(), screenPoint);
                const sx = screenPoint.x * w;
                const sy = screenPoint.y * h;
                if (Math.abs(sx - e.offsetX) < 8 && Math.abs(sy - e.offsetY) < 8) {
                    hitId = id;
                    break;
                }
            }

            if (hitId) {
                // Toggle selection: clicking same point deselects, clicking different selects
                manager.selectPoint(manager.selectedPointId === hitId ? null : hitId);
                e.preventDefault();
                e.stopPropagation();
                return;
            }

            // No hit — place a new point
            const result = await scene.camera.intersect(e.offsetX / w, e.offsetY / h);
            if (result) {
                worldPos.copy(result.position);
            } else {
                // Fallback: use current focal point
                worldPos.copy(scene.camera.focalPoint);
            }

            // Convert world → contentRoot local
            mat.copy(scene.contentRoot.getWorldTransform());
            mat.invert();
            mat.transformPoint(worldPos, localPos);

            const point = manager.addPoint([localPos.x, localPos.y, localPos.z], null);
            manager.selectPoint(point.id);

            e.preventDefault();
            e.stopPropagation();
        };

        this.activate = () => {
            active = true;
            canvasContainer.dom.addEventListener('pointerdown', pointerdown);
            canvasContainer.dom.addEventListener('pointermove', pointermove);
            canvasContainer.dom.addEventListener('pointerup', pointerup, true);
            events.fire('transformHandler.push', transformHandler);
        };

        this.deactivate = () => {
            active = false;
            manager.selectPoint(null);
            canvasContainer.dom.removeEventListener('pointerdown', pointerdown);
            canvasContainer.dom.removeEventListener('pointermove', pointermove);
            canvasContainer.dom.removeEventListener('pointerup', pointerup, true);
            events.fire('transformHandler.pop');
        };
    }
}

export { AnnotationTool };
