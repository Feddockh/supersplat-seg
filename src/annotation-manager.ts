import { Events } from './events';

interface AnnotationClass {
    id: string;
    name: string;
    color: [number, number, number];
}

interface AnnotationPointData {
    id: string;
    position: [number, number, number];
    classId: string | null;
}

interface AnnotationExport {
    version: 1;
    classes: AnnotationClass[];
    points: AnnotationPointData[];
}

class AnnotationManager {
    classes = new Map<string, AnnotationClass>();
    points = new Map<string, AnnotationPointData>();
    selectedPointId: string | null = null;

    private events: Events;

    constructor(events: Events) {
        this.events = events;
    }

    get selectedPoint(): AnnotationPointData | null {
        return this.selectedPointId ? (this.points.get(this.selectedPointId) ?? null) : null;
    }

    addClass(name: string, color: [number, number, number]): AnnotationClass {
        const cls: AnnotationClass = { id: crypto.randomUUID(), name, color };
        this.classes.set(cls.id, cls);
        this.events.fire('annotation.classAdded', cls);
        return cls;
    }

    updateClass(id: string, name: string, color: [number, number, number]) {
        const cls = this.classes.get(id);
        if (!cls) return;
        cls.name = name;
        cls.color = color;
        this.events.fire('annotation.classUpdated', cls);
    }

    deleteClass(id: string) {
        if (!this.classes.has(id)) return;
        this.classes.delete(id);
        // orphan points that used this class
        for (const point of this.points.values()) {
            if (point.classId === id) {
                point.classId = null;
                this.events.fire('annotation.pointUpdated', point);
            }
        }
        this.events.fire('annotation.classDeleted', id);
    }

    addPoint(position: [number, number, number], classId: string | null): AnnotationPointData {
        const point: AnnotationPointData = { id: crypto.randomUUID(), position, classId };
        this.points.set(point.id, point);
        this.events.fire('annotation.pointAdded', point);
        return point;
    }

    updatePointClass(id: string, classId: string | null) {
        const point = this.points.get(id);
        if (!point) return;
        point.classId = classId;
        this.events.fire('annotation.pointUpdated', point);
    }

    updatePointPosition(id: string, position: [number, number, number]) {
        const point = this.points.get(id);
        if (!point) return;
        point.position = position;
        this.events.fire('annotation.pointUpdated', point);
    }

    deletePoint(id: string) {
        if (!this.points.has(id)) return;
        if (this.selectedPointId === id) {
            this.selectedPointId = null;
            this.events.fire('annotation.selectionChanged', null);
        }
        this.points.delete(id);
        this.events.fire('annotation.pointDeleted', id);
    }

    selectPoint(id: string | null) {
        if (this.selectedPointId === id) return;
        this.selectedPointId = id;
        this.events.fire('annotation.selectionChanged', id ? (this.points.get(id) ?? null) : null);
    }

    exportJson(): AnnotationExport {
        return {
            version: 1,
            classes: Array.from(this.classes.values()),
            points: Array.from(this.points.values())
        };
    }

    importJson(data: AnnotationExport) {
        // delete existing points first so entities are cleaned up
        for (const id of this.points.keys()) {
            this.events.fire('annotation.pointDeleted', id);
        }
        this.points.clear();
        this.classes.clear();
        this.selectedPointId = null;

        for (const cls of data.classes) {
            this.classes.set(cls.id, { ...cls });
            this.events.fire('annotation.classAdded', cls);
        }

        for (const point of data.points) {
            const p = { ...point };
            this.points.set(p.id, p);
            this.events.fire('annotation.pointAdded', p);
        }

        this.events.fire('annotation.selectionChanged', null);
    }
}

export { AnnotationManager, AnnotationClass, AnnotationPointData, AnnotationExport };
