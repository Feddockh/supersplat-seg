import { Events } from './events';
import { SemanticLabelManager, SemanticCentroidExport } from './semantic-labels';

const pickerType = [{
    description: 'Segmentation JSON',
    accept: { 'application/json': ['.json'] as `.${string}`[] }
}];

const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
};

const saveJson = async (data: unknown, suggestedName: string) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });

    if ((window as any).showSaveFilePicker) {
        try {
            const handle = await (window as any).showSaveFilePicker({
                id: 'SuperSplatSegmentationExport',
                types: pickerType,
                suggestedName
            });
            const writable = await handle.createWritable();
            await writable.write(blob);
            await writable.close();
        } catch (err: any) {
            if (err?.name !== 'AbortError') console.error(err);
        }
    } else {
        downloadBlob(blob, suggestedName);
    }
};

const initAnnotationIO = (events: Events, manager: SemanticLabelManager) => {
    const transformCentroidsForExport = (data: SemanticCentroidExport): SemanticCentroidExport => {
        const zUp = events.invoke('view.zUp') ?? false;
        if (!zUp) return data;

        const worldToDisplay = (wx: number, wy: number, wz: number) =>
            ({ x: wx, y: -wz, z: wy });

        return {
            version: data.version,
            segments: data.segments.map(seg => ({
                ...seg,
                centroid: (() => {
                    const disp = worldToDisplay(seg.centroid[0], seg.centroid[1], seg.centroid[2]);
                    return [disp.x, disp.y, disp.z] as [number, number, number];
                })()
            }))
        };
    };

    events.function('annotation.hasPoints', () => manager.exportCentroids().segments.length > 0);

    events.function('annotation.export', async () => {
        const data = transformCentroidsForExport(manager.exportCentroids());
        await saveJson(data, 'segmentation-centroids.json');
    });

    events.function('annotation.exportCentroids', async () => {
        const data = transformCentroidsForExport(manager.exportCentroids());
        await saveJson(data, 'segmentation-centroids.json');
    });

    events.function('annotation.import', async () => {
        console.warn('Segmentation import is not implemented yet.');
    });
};

export { initAnnotationIO };
