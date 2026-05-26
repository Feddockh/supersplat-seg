import { Container } from '@playcanvas/pcui';
import { Vec3 } from 'playcanvas';

import { Events } from '../events';

const fmt3 = (v: number) => v.toFixed(3);
const fmt1 = (v: number) => v.toFixed(1);

const makeField = (label: string, step: string, title: string) => {
    const wrap = document.createElement('div');
    wrap.className = 'cpd-field';

    const lbl = document.createElement('span');
    lbl.className = 'cpd-label';
    lbl.textContent = label;

    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'cpd-input';
    input.step = step;
    input.title = title;

    wrap.appendChild(lbl);
    wrap.appendChild(input);
    return { wrap, input };
};

class CameraPoseOverlay extends Container {
    constructor(events: Events) {
        super({ id: 'camera-pose-overlay' });

        this.dom.addEventListener('pointerdown', e => e.stopPropagation());

        let zUp: boolean = events.invoke('view.zUp') ?? false;
        events.on('view.zUp', (v: boolean) => { zUp = v; });

        // -- Position row --
        const posRow = document.createElement('div');
        posRow.className = 'cpd-row';

        const fx  = makeField('X', '0.1', 'Camera X (right/left)');
        const fy  = makeField('Y', '0.1', 'Camera Y');
        const fz  = makeField('Z', '0.1', 'Camera Z');

        posRow.appendChild(fx.wrap);
        posRow.appendChild(fy.wrap);
        posRow.appendChild(fz.wrap);

        // -- Rotation row --
        const rotRow = document.createElement('div');
        rotRow.className = 'cpd-row';

        const fr  = makeField('R', '1', 'Roll (always 0 for orbit camera)');
        const fp  = makeField('P', '1', 'Pitch');
        const fy2 = makeField('Y', '1', 'Yaw');

        fr.input.readOnly = true;
        fr.input.value = '0.0';

        rotRow.appendChild(fr.wrap);
        rotRow.appendChild(fp.wrap);
        rotRow.appendChild(fy2.wrap);

        this.dom.appendChild(posRow);
        this.dom.appendChild(rotRow);

        // Z-up ON  → data Z-up frame: display (X, Y, Z) = (wx, −wz, wy)
        //            angles: P = elevation, Y = azimuth
        // Z-up OFF → raw world Y-up:   display (X, Y, Z) = (wx,  wy, wz)
        //            angles: P = azimuth, Y = elevation  (flipped)

        const worldToDisplay = (wx: number, wy: number, wz: number) =>
            zUp ? { x: wx, y: -wz, z: wy } : { x: wx, y: wy, z: wz };

        const displayToWorld = (dx: number, dy: number, dz: number) =>
            zUp ? { x: dx, y: dz, z: -dy } : { x: dx, y: dy, z: dz };

        // -- Live update every frame --
        events.on('prerender', () => {
            const pose = events.invoke('camera.getPose') as {
                position: { x: number, y: number, z: number };
                target:   { x: number, y: number, z: number };
            } | undefined;
            const angles = events.invoke('camera.getAzimElev') as { azim: number, elevation: number } | undefined;

            if (!pose || !angles) return;

            const disp = worldToDisplay(pose.position.x, pose.position.y, pose.position.z);

            if (document.activeElement !== fx.input)  fx.input.value  = fmt3(disp.x);
            if (document.activeElement !== fy.input)  fy.input.value  = fmt3(disp.y);
            if (document.activeElement !== fz.input)  fz.input.value  = fmt3(disp.z);

            if (zUp) {
                if (document.activeElement !== fp.input)  fp.input.value  = fmt1(angles.elevation);
                if (document.activeElement !== fy2.input) fy2.input.value = fmt1(angles.azim);
            } else {
                if (document.activeElement !== fp.input)  fp.input.value  = fmt1(angles.azim);
                if (document.activeElement !== fy2.input) fy2.input.value = fmt1(angles.elevation);
            }
        });

        // -- Apply position when user commits a value --
        const applyPosition = () => {
            const pose = events.invoke('camera.getPose') as {
                position: { x: number, y: number, z: number };
                target:   { x: number, y: number, z: number };
            };

            const dx = parseFloat(fx.input.value);
            const dy = parseFloat(fy.input.value);
            const dz = parseFloat(fz.input.value);
            if (!isFinite(dx) || !isFinite(dy) || !isFinite(dz)) return;

            const newWorld = displayToWorld(dx, dy, dz);
            const curWorld = displayToWorld(
                ...Object.values(worldToDisplay(pose.position.x, pose.position.y, pose.position.z)) as [number, number, number]
            );

            const wdx = newWorld.x - curWorld.x;
            const wdy = newWorld.y - curWorld.y;
            const wdz = newWorld.z - curWorld.z;

            events.fire('camera.setPose', {
                position: new Vec3(newWorld.x, newWorld.y, newWorld.z),
                target: new Vec3(
                    pose.target.x + wdx,
                    pose.target.y + wdy,
                    pose.target.z + wdz
                )
            }, 1);
        };

        // -- Apply angles when user commits a value --
        const applyAngles = () => {
            const vp  = parseFloat(fp.input.value);
            const vy2 = parseFloat(fy2.input.value);
            if (!isFinite(vp) || !isFinite(vy2)) return;

            const azim      = zUp ? vy2 : vp;
            const elevation = zUp ? vp  : vy2;
            events.fire('camera.setAzimElev', { azim, elevation });
        };

        for (const { input, fn } of [
            { input: fx.input,  fn: applyPosition },
            { input: fy.input,  fn: applyPosition },
            { input: fz.input,  fn: applyPosition }
        ]) {
            input.addEventListener('change', fn);
            input.addEventListener('keydown', (e: KeyboardEvent) => {
                if (e.key === 'Enter') { fn(); (e.target as HTMLInputElement).blur(); }
                e.stopPropagation();
            });
            input.addEventListener('keyup', e => e.stopPropagation());
        }

        for (const { input, fn } of [
            { input: fp.input,  fn: applyAngles },
            { input: fy2.input, fn: applyAngles }
        ]) {
            input.addEventListener('change', fn);
            input.addEventListener('keydown', (e: KeyboardEvent) => {
                if (e.key === 'Enter') { fn(); (e.target as HTMLInputElement).blur(); }
                e.stopPropagation();
            });
            input.addEventListener('keyup', e => e.stopPropagation());
        }
    }
}

export { CameraPoseOverlay };
