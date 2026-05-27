import { Color, Entity, Mat4, StandardMaterial, Vec3 } from 'playcanvas';

import { Events } from './events';
import { Scene } from './scene';
import { SemanticLabelManager } from './semantic-labels';

const initCentroidMarkers = (events: Events, scene: Scene, manager: SemanticLabelManager) => {
    const markerEntities: Entity[] = [];
    const invWorld = new Mat4();
    const worldPos = new Vec3();
    const localPos = new Vec3();

    const markerRadius = () => Math.max(0.006, Math.min(0.05, scene.camera.sceneRadius * 0.012));

    const clearMarkers = () => {
        for (const entity of markerEntities) {
            scene.contentRoot.removeChild(entity);
            entity.destroy();
        }
        markerEntities.length = 0;
        scene.forceRender = true;
    };

    const computeAndShow = () => {
        clearMarkers();
        const result = manager.exportCentroids();
        if (result.segments.length === 0) return;

        const radius = markerRadius();
        invWorld.copy(scene.contentRoot.getWorldTransform()).invert();

        for (const seg of result.segments) {
            const cls = manager.classes.get(seg.classId);
            if (!cls) continue;

            const entity = new Entity(`centroid_${seg.classId}_${seg.clusterIndex}`);
            entity.addComponent('render', { type: 'sphere' });
            (entity.render as any).layers = [scene.worldLayer.id];

            const mat = new StandardMaterial();
            mat.useLighting = false;
            mat.emissive = new Color(cls.color[0], cls.color[1], cls.color[2]);
            mat.emissiveIntensity = 1;
            mat.update();

            entity.render.meshInstances[0].material = mat;
            entity.setLocalScale(radius, radius, radius);

            worldPos.set(seg.centroid[0], seg.centroid[1], seg.centroid[2]);
            invWorld.transformPoint(worldPos, localPos);
            entity.setLocalPosition(localPos.x, localPos.y, localPos.z);

            scene.contentRoot.addChild(entity);
            markerEntities.push(entity);
        }

        scene.forceRender = true;
    };

    events.on('semantic.computeCentroids', computeAndShow);
    events.on('semantic.clearCentroids', clearMarkers);
};

export { initCentroidMarkers };
