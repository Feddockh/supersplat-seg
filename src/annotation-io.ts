import { Events } from './events';
import { SemanticLabelManager } from './semantic-labels';

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
    events.function('annotation.hasPoints', () => manager.exportCentroids().segments.length > 0);

    events.function('annotation.export', async () => {
        await saveJson(manager.exportCentroids(), 'segmentation-centroids.json');
    });

    events.function('annotation.exportCentroids', async () => {
        await saveJson(manager.exportCentroids(), 'segmentation-centroids.json');
    });

    events.function('annotation.import', async () => {
        console.warn('Segmentation import is not implemented yet.');
    });
};

export { initAnnotationIO };
