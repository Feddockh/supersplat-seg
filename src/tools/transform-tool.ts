import { Color, Entity, Mat4, Quat, Vec3, TransformGizmo } from 'playcanvas';

import { Events } from '../events';
import { Pivot } from '../pivot';
import { Scene } from '../scene';

class TransformTool {
    activate: () => void;
    deactivate: () => void;

    constructor(gizmo: TransformGizmo, events: Events, scene: Scene) {
        let pivot: Pivot;
        let active = false;
        let dragging = false;

        // create the transform pivot
        const pivotEntity = new Entity('gizmoPivot');
        scene.app.root.addChild(pivotEntity);

        gizmo.on('render:update', () => {
            scene.forceRender = true;
        });

        // Temporaries for contentRoot-local ↔ world conversion
        const _crInvMat = new Mat4();
        const _worldPos = new Vec3();
        const _localPos = new Vec3();
        const _localRot = new Quat();

        // Place the gizmo pivot entity in world space from a contentRoot-local pivot transform.
        // pivot.transform is always in contentRoot-local space (from getPivot/entity.getLocalPosition).
        const placeGizmoPivot = () => {
            const crWorld = scene.contentRoot.getWorldTransform();
            crWorld.transformPoint(pivot.transform.position, _worldPos);
            const worldRot = new Quat().mul2(scene.contentRoot.getRotation(), pivot.transform.rotation);
            pivotEntity.setLocalPosition(_worldPos);
            pivotEntity.setLocalRotation(worldRot);
            pivotEntity.setLocalScale(pivot.transform.scale);
        };

        // Read the gizmo pivot entity world TRS back into contentRoot-local space for the pivot.
        const readGizmoPivot = () => {
            _crInvMat.invert(scene.contentRoot.getWorldTransform());
            _crInvMat.transformPoint(pivotEntity.getLocalPosition(), _localPos);
            _localRot.copy(scene.contentRoot.getRotation()).invert();
            _localRot.mul2(_localRot, pivotEntity.getLocalRotation());
            pivot.moveTRS(_localPos, _localRot, pivotEntity.getLocalScale());
        };

        gizmo.on('transform:start', () => {
            dragging = true;
            pivot.start();
        });

        gizmo.on('transform:move', () => {
            readGizmoPivot();
            scene.forceRender = true;
        });

        gizmo.on('transform:end', () => {
            pivot.end();
            dragging = false;
        });

        // reattach the gizmo to the pivot
        const reattach = () => {
            if (!active || !events.invoke('selection')) {
                if (gizmo.enabled) {
                    gizmo.detach();
                }
            } else if (!dragging) {
                pivot = events.invoke('pivot') as Pivot;
                placeGizmoPivot();
                gizmo.attach([pivotEntity]);
            }
        };

        events.on('tool.coordSpace', (coordSpace: string) => {
            gizmo.coordSpace = coordSpace as 'local' | 'world';
        });

        // set the gizmo size to remain a constant size in screen space.
        // called in response to changes in canvas size
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

        this.activate = () => {
            active = true;

            reattach();

            events.on('pivot.placed', reattach);
            events.on('pivot.moved', reattach);
            events.on('selection.changed', reattach);
        };

        this.deactivate = () => {
            active = false;
            reattach();

            events.off('pivot.placed', reattach);
            events.off('pivot.moved', reattach);
            events.off('selection.changed', reattach);
        };

        // initialize coodinate space
        gizmo.coordSpace = events.invoke('tool.coordSpace');

        // swap Y/Z axis colors when Z-up is active (world-Y = data-Z should be blue, world-Z = data-Y should be green)
        const defaultYColor = gizmo.yAxisColor.clone();
        const defaultZColor = gizmo.zAxisColor.clone();

        const setGizmoZUp = (zUp: boolean) => {
            gizmo.yAxisColor = zUp ? defaultZColor.clone() : defaultYColor.clone();
            gizmo.zAxisColor = zUp ? defaultYColor.clone() : defaultZColor.clone();
        };

        events.on('view.zUp', setGizmoZUp);
        setGizmoZUp(events.invoke('view.zUp') ?? false);
    }
}

export { TransformTool };
