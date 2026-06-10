import { Button, Container, ContainerArgs, Label, NumericInput, VectorInput } from '@playcanvas/pcui';
import { Quat, Vec3 } from 'playcanvas';

import { Events } from '../events';
import { localize } from './localization';
import { Pivot } from '../pivot';

const v = new Vec3();

class Transform extends Container {
    constructor(events: Events, args: ContainerArgs = {}) {
        args = {
            ...args,
            id: 'transform'
        };

        super(args);

        // position
        const position = new Container({
            class: 'transform-row'
        });

        const positionLabel = new Label({
            class: 'transform-label',
            text: localize('panel.scene-manager.transform.position')
        });

        const positionVector = new VectorInput({
            class: 'transform-expand',
            precision: 3,
            dimensions: 3,
            placeholder: ['X', 'Y', 'Z'],
            value: [0, 0, 0],
            enabled: false
        });

        position.append(positionLabel);
        position.append(positionVector);

        // rotation
        const rotation = new Container({
            class: 'transform-row'
        });

        const rotationLabel = new Label({
            class: 'transform-label',
            text: localize('panel.scene-manager.transform.rotation')
        });

        const rotationVector = new VectorInput({
            class: 'transform-expand',
            precision: 2,
            dimensions: 3,
            placeholder: ['X', 'Y', 'Z'],
            value: [0, 0, 0],
            enabled: false
        });

        rotation.append(rotationLabel);
        rotation.append(rotationVector);

        // scale
        const scale = new Container({
            class: 'transform-row'
        });

        const scaleLabel = new Label({
            class: 'transform-label',
            text: localize('panel.scene-manager.transform.scale')
        });

        const scaleInput = new NumericInput({
            class: 'transform-expand',
            precision: 3,
            value: 1,
            min: 0.001,
            max: 10000,
            enabled: false
        });

        scale.append(scaleLabel);
        scale.append(scaleInput);

        // gaussian size
        const gaussianSize = new Container({
            class: 'transform-row'
        });

        const gaussianSizeLabel = new Label({
            class: 'transform-label',
            text: localize('panel.scene-manager.transform.gaussianSize')
        });

        const gaussianSizeInput = new NumericInput({
            class: 'transform-expand',
            precision: 3,
            value: 1,
            min: 0.01,
            max: 100,
            enabled: false
        });

        gaussianSize.append(gaussianSizeLabel);
        gaussianSize.append(gaussianSizeInput);

        // copy/paste buttons
        const actions = new Container({
            class: 'transform-row'
        });

        const copyButton = new Button({
            class: 'transform-expand',
            text: 'Copy',
            enabled: false
        });

        const pasteButton = new Button({
            class: 'transform-expand',
            text: 'Paste',
            enabled: false
        });

        const resetButton = new Button({
            class: 'transform-expand',
            text: 'Reset',
            enabled: false
        });

        actions.append(copyButton);
        actions.append(pasteButton);
        actions.append(resetButton);

        this.append(position);
        this.append(rotation);
        this.append(scale);
        this.append(gaussianSize);
        this.append(actions);

        const toArray = (v: Vec3) => {
            return [v.x, v.y, v.z];
        };

        let uiUpdating = false;
        let mouseUpdating = false;

        // update UI with pivot
        const updateUI = (pivot: Pivot) => {
            uiUpdating = true;
            const transform = pivot.transform;
            transform.rotation.getEulerAngles(v);
            positionVector.value = toArray(transform.position);
            rotationVector.value = toArray(v);
            scaleInput.value = transform.scale.x;
            uiUpdating = false;
        };

        // update pivot with UI
        const updatePivot = (pivot: Pivot) => {
            const p = positionVector.value;
            const r = rotationVector.value;
            const q = new Quat().setFromEulerAngles(r[0], r[1], r[2]);
            const s = scaleInput.value;

            if (q.w < 0) {
                q.mulScalar(-1);
            }

            pivot.moveTRS(new Vec3(p[0], p[1], p[2]), q, new Vec3(s, s, s));
        };

        // handle a change in the UI state
        const change = () => {
            if (!uiUpdating) {
                const pivot = events.invoke('pivot') as Pivot;
                if (mouseUpdating) {
                    updatePivot(pivot);
                } else {
                    pivot.start();
                    updatePivot(pivot);
                    pivot.end();
                }
            }
        };

        const mousedown = () => {
            mouseUpdating = true;
            const pivot = events.invoke('pivot') as Pivot;
            pivot.start();
        };

        const mouseup = () => {
            const pivot = events.invoke('pivot') as Pivot;
            updatePivot(pivot);
            mouseUpdating = false;
            pivot.end();
        };

        [positionVector.inputs, rotationVector.inputs, scaleInput].flat().forEach((input) => {
            input.on('change', change);
            input.on('slider:mousedown', mousedown);
            input.on('slider:mouseup', mouseup);
        });

        let lastGaussianScaleValue = 1;
        gaussianSizeInput.on('change', () => {
            const newValue = gaussianSizeInput.value;
            if (newValue !== lastGaussianScaleValue && newValue > 0) {
                const multiplier = newValue / lastGaussianScaleValue;
                events.fire('transform.inflateGaussians', multiplier);
                lastGaussianScaleValue = newValue;
            }
        });

        copyButton.on('click', async () => {
            const payload = JSON.stringify({
                position: positionVector.value,
                rotation: rotationVector.value,
                scale: scaleInput.value
            });
            try {
                await navigator.clipboard.writeText(payload);
            } catch (err) {
                console.error('Failed to copy transform to clipboard', err);
            }
        });

        pasteButton.on('click', async () => {
            let data: { position: number[], rotation: number[], scale: number };
            try {
                const text = await navigator.clipboard.readText();
                data = JSON.parse(text);
            } catch (err) {
                console.error('Failed to paste transform from clipboard', err);
                return;
            }

            if (!Array.isArray(data?.position) || data.position.length !== 3 ||
                !Array.isArray(data?.rotation) || data.rotation.length !== 3 ||
                typeof data?.scale !== 'number') {
                console.error('Clipboard does not contain a valid transform');
                return;
            }

            const pivot = events.invoke('pivot') as Pivot;
            if (!pivot) return;

            uiUpdating = true;
            positionVector.value = data.position;
            rotationVector.value = data.rotation;
            scaleInput.value = data.scale;
            uiUpdating = false;

            pivot.start();
            updatePivot(pivot);
            pivot.end();
        });

        resetButton.on('click', () => {
            const pivot = events.invoke('pivot') as Pivot;
            if (!pivot) return;

            uiUpdating = true;
            positionVector.value = [0, 0, 0];
            rotationVector.value = [0, 0, 0];
            scaleInput.value = 1;
            uiUpdating = false;

            pivot.start();
            updatePivot(pivot);
            pivot.end();
        });

        // toggle ui availability based on selection
        events.on('selection.changed', (selection) => {
            positionVector.enabled = rotationVector.enabled = scaleInput.enabled = gaussianSizeInput.enabled = !!selection;
            copyButton.enabled = pasteButton.enabled = resetButton.enabled = !!selection;
            if (selection) {
                gaussianSizeInput.value = 1;
                lastGaussianScaleValue = 1;
            }
        });

        events.on('pivot.placed', (pivot: Pivot) => {
            updateUI(pivot);
        });

        events.on('pivot.moved', (pivot: Pivot) => {
            if (!mouseUpdating) {
                updateUI(pivot);
            }
        });

        events.on('pivot.ended', (pivot: Pivot) => {
            updateUI(pivot);
        });
    }
}

export { Transform };
