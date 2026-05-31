import { Container } from '@playcanvas/pcui';
import { Color, Entity, StandardMaterial, Vec3 } from 'playcanvas';

import { AlignmentManager, AlignmentPickSide } from '../alignment';
import { Events } from '../events';
import { Scene } from '../scene';

class AlignmentTransformHandler {
    activate() {}
    deactivate() {}
}

type MarkerEntity = {
    entity: Entity;
    material: StandardMaterial;
};

const sourceColor = new Color(1, 0.45, 0.05);
const targetColor = new Color(0.1, 0.75, 1);

class AlignmentTool {
    activate: () => void;
    deactivate: () => void;

    constructor(
        events: Events,
        scene: Scene,
        manager: AlignmentManager,
        canvasContainer: Container
    ) {
        const transformHandler = new AlignmentTransformHandler();
        const markers = new Map<string, MarkerEntity>();
        let active = false;
        let clicked = false;
        // pointer position at press time, used to distinguish a click from a drag
        let downX = 0;
        let downY = 0;
        // allow a few pixels of drift between press and release before treating
        // the gesture as a drag (orbit) rather than a click
        const dragThreshold = 4;

        const markerRadius = () => Math.max(0.006, Math.min(0.05, scene.camera.sceneRadius * 0.012));

        const createMarker = (id: string, side: AlignmentPickSide, parent: Entity, position: Vec3) => {
            const entity = new Entity(`alignment_${id}`);
            entity.addComponent('render', { type: 'sphere' });
            (entity.render as any).layers = [scene.worldLayer.id];

            const material = new StandardMaterial();
            material.useLighting = false;
            material.emissive.copy(side === 'source' ? sourceColor : targetColor);
            material.emissiveIntensity = 1;
            material.update();

            entity.render.meshInstances[0].material = material;
            const radius = markerRadius();
            entity.setLocalScale(radius, radius, radius);
            entity.setLocalPosition(position);
            parent.addChild(entity);

            markers.set(id, { entity, material });
        };

        const clearMarkers = () => {
            for (const [, marker] of markers) {
                marker.entity.parent?.removeChild(marker.entity);
                marker.entity.destroy();
            }
            markers.clear();
        };

        const rebuildMarkers = () => {
            clearMarkers();
            if (!active) {
                return;
            }

            for (const pair of manager.pairs) {
                if (pair.source && manager.source) {
                    createMarker(`${pair.id}_source`, 'source', manager.source.entity, pair.source.position);
                }
                if (pair.target && manager.target) {
                    createMarker(`${pair.id}_target`, 'target', manager.target.entity, pair.target.position);
                }
            }
            scene.forceRender = true;
        };

        events.on('alignment.changed', rebuildMarkers);

        const isPrimary = (e: PointerEvent) => {
            return e.pointerType === 'mouse' ? e.button === 0 : e.isPrimary;
        };

        const pointerdown = (e: PointerEvent) => {
            if (!clicked && isPrimary(e)) {
                clicked = true;
                downX = e.offsetX;
                downY = e.offsetY;
            }
        };

        const pointermove = (e: PointerEvent) => {
            // only cancel the pending click once the pointer has moved beyond the
            // drag threshold, so tiny drift while pressing the button is tolerated
            if (clicked && Math.hypot(e.offsetX - downX, e.offsetY - downY) > dragThreshold) {
                clicked = false;
            }
        };

        const pointerup = async (e: PointerEvent) => {
            if (!active || !clicked || !isPrimary(e)) {
                return;
            }
            clicked = false;

            // restrict picking to the splat for the active pick side, so points always
            // land on the intended scan even where the two splats overlap on screen
            const expectedSplat = manager.pickSide === 'source' ? manager.source : manager.target;
            if (!expectedSplat) {
                return;
            }

            const result = await scene.camera.intersect(
                e.offsetX / canvasContainer.dom.clientWidth,
                e.offsetY / canvasContainer.dom.clientHeight,
                expectedSplat
            );

            if (result) {
                manager.addPickedPoint(result.splat, result.position);
                e.preventDefault();
                e.stopPropagation();
            }
        };

        this.activate = () => {
            active = true;
            canvasContainer.dom.addEventListener('pointerdown', pointerdown);
            canvasContainer.dom.addEventListener('pointermove', pointermove);
            canvasContainer.dom.addEventListener('pointerup', pointerup, true);
            events.fire('alignment.active', true);
            events.fire('transformHandler.push', transformHandler);
            rebuildMarkers();
        };

        this.deactivate = () => {
            active = false;
            manager.revertPreview();
            canvasContainer.dom.removeEventListener('pointerdown', pointerdown);
            canvasContainer.dom.removeEventListener('pointermove', pointermove);
            canvasContainer.dom.removeEventListener('pointerup', pointerup, true);
            events.fire('alignment.active', false);
            events.fire('transformHandler.pop');
            clearMarkers();
            scene.forceRender = true;
        };
    }
}

export { AlignmentTool };
