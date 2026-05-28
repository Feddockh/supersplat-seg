import { AppBase, Asset } from 'playcanvas';

import { Events } from './events';
import { Mesh } from './mesh';

// handles loading GLB/glTF assets via PlayCanvas's container asset type
class MeshLoader {
    app: AppBase;
    events: Events;

    constructor(app: AppBase, events: Events) {
        this.app = app;
        this.events = events;
    }

    async load(filename: string, file: File | Blob | ArrayBuffer): Promise<Mesh> {
        this.events.fire('startSpinner');

        let blobUrl: string | null = null;

        try {
            // create a blob URL that PlayCanvas's container loader can fetch
            const blob = file instanceof Blob ? file : new Blob([file]);
            blobUrl = URL.createObjectURL(blob);

            const asset = new Asset(filename, 'container', {
                url: blobUrl,
                filename
            });

            await new Promise<void>((resolve, reject) => {
                asset.once('load', () => resolve());
                asset.once('error', (err: any) => reject(new Error(typeof err === 'string' ? err : (err?.message ?? 'failed to load GLB'))));
                this.app.assets.add(asset);
                this.app.assets.load(asset);
            });

            return new Mesh(asset, filename);
        } finally {
            if (blobUrl) URL.revokeObjectURL(blobUrl);
            this.events.fire('stopSpinner');
        }
    }
}

export { MeshLoader };
